import { afterEach, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ComparisonDetailsSchema, RunnerComparisonSchema } from '@crewstation/contracts';
import { createWorkspaceComparisons } from '../src/workspace/workspaceComparison';
import { gitWorkspaceFixture } from './gitWorkspaceFixture';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture() {
  const f = await gitWorkspaceFixture();
  cleanups.push(f.dispose);
  return { ...f, comparisons: createWorkspaceComparisons(f) };
}

test('实际 H 与 P 的相同／领先／落后／分叉用双向提交数表示，并按固定比较分页', async () => {
  const f = await fixture();
  const base = await f.commit('base');
  expect((await f.comparisons.compare(base)).commits).toEqual({ status: 'equal', ahead: 0, behind: 0 });
  const h1 = await f.commit('h1');
  const h2 = await f.commit('h2');
  const ahead = RunnerComparisonSchema.parse(await f.comparisons.compare(base));
  expect(ahead.commits).toEqual({ status: 'ahead', ahead: 2, behind: 0 });
  expect((await f.comparisons.compare(base)).comparisonId).toBe(ahead.comparisonId);
  const page = ComparisonDetailsSchema.parse(await f.comparisons.details(ahead.comparisonId!, { tab: 'ahead', limit: 1 }));
  expect(page.commits).toEqual([{ sha: h2, subject: 'h2' }]);
  expect(page.nextCursor).toBe('1');
  expect((await f.comparisons.details(ahead.comparisonId!, { tab: 'ahead', cursor: '1', limit: 1 })).commits).toEqual([{ sha: h1, subject: 'h1' }]);
  await f.git.checked(['checkout', '-b', 'production', base]);
  expect((await f.comparisons.compare(h2)).commits).toEqual({ status: 'behind', ahead: 0, behind: 2 });
  const p = await f.commit('production');
  await f.git.checked(['checkout', 'main']);
  expect((await f.comparisons.compare(p)).commits).toEqual({ status: 'diverged', ahead: 2, behind: 1 });
});

test('未部署、缺对象、浅历史和无共同历史互不混淆，未知不带零计数', async () => {
  const f = await fixture();
  const first = await f.commit('first');
  expect((await f.comparisons.compare()).commits).toEqual({ status: 'undeployed' });
  expect((await f.comparisons.compare('f'.repeat(40))).commits).toMatchObject({ status: 'unavailable' });
  await f.git.checked(['checkout', '--orphan', 'orphan']);
  const unrelated = await f.commit('unrelated');
  expect((await f.comparisons.compare(first)).commits).toEqual({ status: 'unrelated' });
  await Bun.write(join(f.root, '.git/shallow'), `${unrelated}\n`);
  expect((await f.comparisons.compare(first)).commits).toMatchObject({ status: 'unavailable' });
});

test('提交与未提交文件互相抵消时，净差异为零，但 dirty 仍在；未提交不会计成提交', async () => {
  const f = await fixture();
  await f.write('file.txt', 'production\n');
  const p = await f.commit('production');
  await f.write('file.txt', 'committed change\n');
  await f.commit('change');
  await f.write('file.txt', 'production\n');
  const result = await f.comparisons.compare(p);
  expect(result.commits).toEqual({ status: 'ahead', ahead: 1, behind: 0 });
  expect(result.files).toMatchObject({ status: 'ready', count: 0 });
  expect(result.workspace).toMatchObject({ uncommittedCount: 1 });
  const dirty = await f.comparisons.details(result.comparisonId!, { tab: 'uncommitted', limit: 50 });
  expect(dirty.files.map((file) => file.path)).toEqual(['file.txt']);
});

test('文件从 HEAD 删除后以 untracked 恢复，不被重复算成删除加新增', async () => {
  const f = await fixture();
  await f.write('restored.txt', 'original\n');
  const p = await f.commit('production');
  await rm(join(f.root, 'restored.txt'));
  await f.commit('remove');
  await f.write('restored.txt', 'original\n');
  expect((await f.comparisons.compare(p)).files).toMatchObject({ status: 'ready', count: 0 });
  await f.write('restored.txt', 'changed\n');
  const result = await f.comparisons.compare(p);
  expect(result.files).toMatchObject({ status: 'ready', count: 1, untrackedCount: 1 });
  const details = await f.comparisons.details(result.comparisonId!, { tab: 'files', limit: 50, path: 'restored.txt' });
  expect(details.patch?.text).toContain('-original');
  expect(details.patch?.text).toContain('+changed');
  expect(details.patch?.text).toContain('+++ b/restored.txt');
  expect(details.patch?.text).not.toContain('cs-comparison-');
});

test('暂存与未暂存抵消仍保留两段 patch，且二进制与空 untracked 文件可见', async () => {
  const f = await fixture();
  await f.write('file.txt', 'initial\n');
  const p = await f.commit('base');
  await f.write('file.txt', 'staged\n');
  await f.git.checked(['add', 'file.txt']);
  await f.write('file.txt', 'initial\n');
  await f.write('binary.bin', new Uint8Array([0, 1, 2]));
  await f.write('empty.txt', '');
  const result = await f.comparisons.compare(p);
  expect(result.files).toMatchObject({ status: 'ready', count: 2 });
  const files = await f.comparisons.details(result.comparisonId!, { tab: 'uncommitted', limit: 50 });
  expect(files.files.map((file) => file.path).sort()).toEqual(['binary.bin', 'empty.txt', 'file.txt']);
  expect(files.files.find((file) => file.path === 'binary.bin')).toMatchObject({ binary: true, additions: null, deletions: null });
  const patch = await f.comparisons.details(result.comparisonId!, { tab: 'uncommitted', limit: 50, path: 'file.txt' });
  expect(patch.patch?.text).toContain('# Staged changes');
  expect(patch.patch?.text).toContain('+staged');
  expect(patch.patch?.text).toContain('-staged');
});

test('比较之后同样行数的写入使详情失效，不能在旧 SHA 标题下返回新文件', async () => {
  const f = await fixture();
  await f.write('file.txt', 'base\n');
  const p = await f.commit('base');
  await f.write('file.txt', 'aaaa\n');
  const result = await f.comparisons.compare(p);
  await f.write('file.txt', 'bbbb\n');
  await expect(f.comparisons.details(result.comparisonId!, { tab: 'files', path: 'file.txt', limit: 50 })).rejects.toMatchObject({ code: 'comparison_stale' });
});

test('首次提交之前也能看暂存与未跟踪 patch，不向仓库写空树对象', async () => {
  const f = await fixture();
  await f.write('staged.txt', 'staged\n');
  await f.git.checked(['add', 'staged.txt']);
  await f.write('new.txt', 'untracked\n');
  const result = await f.comparisons.compare();
  const files = await f.comparisons.details(result.comparisonId!, { tab: 'uncommitted', limit: 50 });
  expect(files.files.map((file) => file.path).sort()).toEqual(['new.txt', 'staged.txt']);
  const staged = await f.comparisons.details(result.comparisonId!, { tab: 'uncommitted', path: 'staged.txt', limit: 50 });
  expect(staged.patch?.text).toContain('+staged');
  const fresh = await f.comparisons.details(result.comparisonId!, { tab: 'uncommitted', path: 'new.txt', limit: 50 });
  expect(fresh.patch?.text).toContain('+untracked');
  expect((await f.git.run(['rev-parse', '--verify', 'HEAD'])).exitCode).not.toBe(0);
});

test('大 patch 明确截断，并限制字节数；不默默把截断结果当完整文件', async () => {
  const f = await fixture();
  const p = await f.commit('base');
  await f.write('large.txt', 'long content 中文\n'.repeat(8000));
  const result = await f.comparisons.compare(p);
  const details = await f.comparisons.details(result.comparisonId!, { tab: 'files', path: 'large.txt', limit: 50 });
  expect(details.patch?.truncated).toBe(true);
  expect(Buffer.byteLength(details.patch?.text ?? '')).toBeLessThanOrEqual(64 * 1024);
});
