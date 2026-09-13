import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { COMPARISON_TTL_MS } from '@crewstation/contracts';
import { comparisonSnapshots } from '../src/workspace/comparisonSnapshots';
import { fetchComparisonHistory } from '../src/workspace/fetchComparisonHistory';
import { createWorkspaceComparisons } from '../src/workspace/workspaceComparison';
import { gitWorkspaceFixture } from './gitWorkspaceFixture';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture(initialize = true) { const f = await gitWorkspaceFixture(initialize); cleanups.push(f.dispose); return f; }

test('显式补齐浅历史只写平台引用和对象，HEAD／branch／index／工作文件／远端引用不变', async () => {
  const origin = await fixture();
  await origin.write('file.txt', 'first\n');
  const p = await origin.commit('first');
  await origin.write('file.txt', 'second\n');
  const h = await origin.commit('second');
  const f = await fixture(false);
  await f.git.checked(['clone', '--depth=1', `file://${origin.root}`, '.']);
  await f.write('file.txt', 'working draft\n');
  const before = await f.status();
  const index = await Bun.file(join(f.root, '.git/index')).arrayBuffer();
  const refs = await f.git.checked(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes', 'refs/tags']);
  const fetchHead = await Bun.file(join(f.root, '.git/FETCH_HEAD')).text().catch(() => undefined);
  const config = await Bun.file(join(f.root, '.git/config')).text();
  expect(before).toMatchObject({ status: 'ready', shallow: true, headSha: h });
  await fetchComparisonHistory(f.git, `file://${origin.root}`, p);
  expect(await f.git.checked(['rev-parse', 'HEAD'])).toBe(`${h}\n`);
  expect(await Bun.file(join(f.root, 'file.txt')).text()).toBe('working draft\n');
  expect(await Bun.file(join(f.root, '.git/index')).arrayBuffer()).toEqual(index);
  expect(await f.git.checked(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes', 'refs/tags'])).toBe(refs);
  expect(await Bun.file(join(f.root, '.git/FETCH_HEAD')).text().catch(() => undefined)).toBe(fetchHead);
  expect(await Bun.file(join(f.root, '.git/config')).text()).toBe(config);
  expect((await createWorkspaceComparisons(f).compare(p)).commits).toEqual({ status: 'ahead', ahead: 1, behind: 0 });
  expect(await f.git.checked(['rev-parse', `refs/crewstation/comparison/commits/${p}`])).toBe(`${p}\n`);
}, 20_000); // 两个真实仓库与浅克隆／fetch／完整比较，保留有界等待而非默认 5 秒。

test('获取失败保留失败原因且不会泄露 URL 的凭据', async () => {
  const f = await fixture();
  await f.commit('base');
  await expect(fetchComparisonHistory({ ...f.git, run: async () => ({ exitCode: 128, stdout: '', stderr: 'fatal: https://oauth2:SECRET@git.example/repo', truncated: false }) }, 'https://oauth2:SECRET@git.example/repo')).rejects.toMatchObject({ code: 'comparison_fetch_failed', message: 'Git 检查失败（exit 128）：fatal: https://git.example/repo' });
});

test('比较快照容量和时间有界，过期和不存在都要求重算', () => {
  let now = 0;
  const snapshots = comparisonSnapshots(1, () => now);
  const value = { id: 'one', createdAt: now } as Parameters<typeof snapshots.save>[0];
  snapshots.save(value);
  expect(snapshots.get('one')).toBe(value);
  snapshots.save({ ...value, id: 'two' });
  expect(() => snapshots.get('one')).toThrow('比较已过期');
  now = COMPARISON_TTL_MS + 1;
  expect(() => snapshots.get('two')).toThrow('比较已过期');
});
