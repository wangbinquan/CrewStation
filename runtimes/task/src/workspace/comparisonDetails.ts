import { COMPARISON_PATCH_BYTES } from '@crewstation/contracts';
import type { ComparisonDetailQuery, ComparisonDetails, ComparisonFile } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';
import type { ComparisonSnapshot } from './comparisonSnapshots';
import type { FileComparisonDeps } from './untrackedDiff';
import { uncommittedFiles, uncommittedPatch } from './uncommittedDiff';
import { workspacePatch } from './workspaceFiles';
import { parseWorkspaceCommits } from './gitStatus';

export async function comparisonDetails(deps: FileComparisonDeps, snapshot: ComparisonSnapshot, query: ComparisonDetailQuery): Promise<ComparisonDetails> {
  const base: ComparisonDetails = { comparisonId: snapshot.id, ...(snapshot.targetSha ? { targetSha: snapshot.targetSha } : {}), tab: query.tab, commits: [], files: [], checkedAt: new Date().toISOString(), truncated: false };
  const offset = Number(query.cursor ?? '0');
  if (query.tab === 'ahead' || query.tab === 'behind') {
    const { status } = snapshot.result.commits;
    if (!snapshot.targetSha || !snapshot.workspace.headSha || status === 'unavailable' || status === 'unrelated') throw new RunnerCommandError('comparison_unavailable', '当前提交关系不可比较');
    const from = query.tab === 'ahead' ? snapshot.targetSha : snapshot.workspace.headSha;
    const to = query.tab === 'ahead' ? snapshot.workspace.headSha : snapshot.targetSha;
    const commits = parseWorkspaceCommits(await deps.git.checked(['log', '--format=%H%x00%s', '-z', `--skip=${offset}`, `--max-count=${query.limit + 1}`, `${from}..${to}`]));
    return { ...base, commits: commits.slice(0, query.limit), ...(commits.length > query.limit ? { nextCursor: String(offset + query.limit) } : {}) };
  }
  const files = query.tab === 'uncommitted' ? await uncommittedFiles(deps, snapshot.workspace) : snapshot.files;
  if (!files) throw new RunnerCommandError('comparison_unavailable', '文件差异暂不可读取，请重新计算');
  if (query.path) return { ...base, patch: await readPatch(deps, snapshot, query, files) };
  return {
    ...base, files: files.slice(offset, offset + query.limit),
    ...(files.length > offset + query.limit ? { nextCursor: String(offset + query.limit) } : {}),
    truncated: query.tab === 'uncommitted' && snapshot.workspace.uncommittedTruncated,
  };
}

async function readPatch(deps: FileComparisonDeps, snapshot: ComparisonSnapshot, query: ComparisonDetailQuery, files: ComparisonFile[]): Promise<NonNullable<ComparisonDetails['patch']>> {
  const file = files.find((entry) => entry.path === query.path);
  if (!file) throw new RunnerCommandError('not_found', '该文件不在当前比较中');
  const output = query.tab === 'uncommitted' ? await uncommittedPatch(deps, snapshot.workspace, file) : await workspacePatch(deps, snapshot.targetSha!, file).then((out) => ({ text: out.stdout, truncated: out.truncated }));
  const encoded = Buffer.from(output.text, 'utf8');
  return { path: file.path, text: encoded.subarray(0, COMPARISON_PATCH_BYTES).toString('utf8').replace(/�+$/, ''), binary: file.binary, truncated: output.truncated || encoded.length > COMPARISON_PATCH_BYTES };
}
