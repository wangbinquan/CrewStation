import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildScript } from './releaseJobs';

async function command(argv: string[], cwd: string, env: Record<string, string | undefined> = {}) {
  const child = Bun.spawn(argv, { cwd, env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, stdout, stderr };
}

test('发布构建脚本真实 Git 检出固定提交，移动分支不改变源码，buildctl 看不到凭据或 .git', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-release-source-'));
  try {
    const repo = join(root, 'repo'), work = join(root, 'work'), bin = join(root, 'bin'), output = join(root, 'output');
    await Promise.all([mkdir(repo), mkdir(bin)]);
    const git = async (...args: string[]) => {
      const result = await command(['git', ...args], repo, { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' });
      if (result.code) throw new Error(result.stderr); return result.stdout.trim();
    };
    await git('init', '-q', '-b', 'main'); await writeFile(join(repo, 'marker'), 'fixed'); await git('add', 'marker'); await git('commit', '-qm', 'first');
    const sha = await git('rev-parse', 'HEAD');
    await writeFile(join(repo, 'marker'), 'moved'); await git('add', 'marker'); await git('commit', '-qm', 'second');
    await writeFile(join(bin, 'buildctl'), '#!/bin/sh\nset -eu\ntest ! -d .git\ntest -z "${GIT_TOKEN+x}"\ntest ! -f "$GIT_ASKPASS"\ncat marker > "$TEST_OUTPUT"\n', { mode: 0o755 });
    // /work 是容器挂载点，测试替换为自己的临时目录，其余脚本原样运行。
    const script = buildScript('tcp://buildkitd:1234').replaceAll('/work', work);
    const env = { PATH: `${bin}:${process.env.PATH}`, REPO_URL: repo, REF: sha, IMAGE: 'registry.test/service:tag', GIT_TOKEN: 'test-build-secret', TEST_OUTPUT: output };
    expect(await command(['sh', '-c', script], root, env)).toMatchObject({ code: 0 });
    expect(await readFile(output, 'utf8')).toBe('fixed');
    await rm(output);
    const invalid = await command(['sh', '-c', script], root, { ...env, REF: 'main' });
    expect(invalid.code).not.toBe(0); expect(invalid.stderr).toContain('source commit mismatch');
    expect(await Bun.file(output).exists()).toBe(false);
    expect(invalid.stdout + invalid.stderr).not.toContain('test-build-secret');
  } finally { await rm(root, { recursive: true, force: true }); }
});
