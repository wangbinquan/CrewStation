import { chmod, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { COMPARISON_SCRATCH_BLOB_BYTES } from '@crewstation/contracts';
import type { ComparisonFile } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';
import type { WorkdirPaths } from '../files/workdirPath';
import type { ProcessLauncher } from '../process/launcher';
import { killProcessTree } from '../process/processTree';
import type { GitCommand, GitOutput } from './gitCommand';
import { gitProblem } from './gitCommand';
import { diffOptions, parseDiffStats } from './gitDiff';

export interface FileComparisonDeps { git: GitCommand; paths: WorkdirPaths; launcher: ProcessLauncher }

/** git diff P 会把已从 index 删除却留在磁盘的文件当删除；用真实内容覆盖这一项，避免双重计数。 */
export async function untrackedDiff(deps: FileComparisonDeps, ref: string | undefined, path: string, patch = false): Promise<{ file?: ComparisonFile; output: GitOutput }> {
  await deps.paths.resolveCwd(dirname(path));
  const current = { absolute: join(deps.paths.root, path) };
  const entry = ref ? (await deps.git.checked(['ls-tree', '-z', ref, '--', `:(literal)${path}`])).split('\t')[0] : undefined;
  const [mode, type, oid] = entry?.split(' ') ?? [];
  if (type && type !== 'blob') throw new RunnerCommandError('git_diff_unavailable', '目标路径是子模块或目录，暂不可生成未跟踪文件差异');
  const scratch = await mkdtemp(join(tmpdir(), 'cs-comparison-'));
  try {
    await deps.launcher.chownToWorker(scratch);
    const base = oid ? join(scratch, 'base') : '/dev/null';
    if (oid) {
      const bytes = await readBlob(deps, oid);
      if (mode === '120000') await symlink(Buffer.from(bytes).toString('utf8'), base);
      else { await Bun.write(base, bytes); await chmod(base, mode === '100755' ? 0o755 : 0o644); }
    }
    const args = ['diff', '--no-index', ...diffOptions, ...(patch ? ['--unified=3'] : ['--numstat', '-z']), '--', base, current.absolute];
    const output = await deps.git.run(args);
    if (output.exitCode !== 0 && output.exitCode !== 1) throw new RunnerCommandError('git_diff_failed', gitProblem(output));
    if (!patch && output.truncated) throw new RunnerCommandError('git_output_limit', '未跟踪文件的差异统计超过读取上限');
    const count = patch ? undefined : [...parseDiffStats(output.stdout).values()][0];
    const text = patch ? patchLabels(output.stdout, path) : output.stdout;
    return { ...(count ? { file: { path, status: oid ? 'M' : 'A', ...count, untracked: true } } : {}), output: { ...output, stdout: text } };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function patchLabels(text: string, path: string): string {
  const quote = (name: string) => /["\\\s]/.test(name) ? JSON.stringify(name) : name;
  const a = quote(`a/${path}`), b = quote(`b/${path}`);
  return text.split('\n').map((line) => {
    if (line.startsWith('diff --git ')) return `diff --git ${a} ${b}`;
    if (line.startsWith('--- ') && line !== '--- /dev/null') return `--- ${a}`;
    if (line.startsWith('+++ ') && line !== '+++ /dev/null') return `+++ ${b}`;
    if (line.startsWith('Binary files ')) return `Binary files ${a} and ${b} differ`;
    return line;
  }).join('\n');
}

/** 只在 OS 临时目录物化 immutable blob，不写工作文件、index 或 Git 对象。 */
async function readBlob(deps: FileComparisonDeps, oid: string): Promise<Uint8Array> {
  const size = Number((await deps.git.checked(['cat-file', '-s', oid])).trim());
  if (!Number.isSafeInteger(size) || size > COMPARISON_SCRATCH_BLOB_BYTES) throw new RunnerCommandError('git_blob_limit', `同名未跟踪文件的目标内容超过 ${COMPARISON_SCRATCH_BLOB_BYTES} 字节，无法生成净差异`);
  const proc = deps.launcher.spawnPiped({ cmd: ['git', 'cat-file', 'blob', oid], cwd: deps.paths.root, env: deps.launcher.baseEnv({ GIT_TERMINAL_PROMPT: '0' }) });
  const timer = setTimeout(() => void killProcessTree(proc), Math.max(1, Math.min(30_000, (deps.git.deadline ?? Infinity) - Date.now())));
  try {
    const [bytes, _stderr, exitCode] = await Promise.all([new Response(proc.stdout).arrayBuffer(), new Response(proc.stderr).text(), proc.exited]);
    if (exitCode !== 0 || bytes.byteLength !== size) throw new RunnerCommandError('git_blob_failed', '读取目标版本内容失败');
    return new Uint8Array(bytes);
  } finally {
    clearTimeout(timer);
  }
}
