import { afterEach, expect, test } from 'bun:test';
import { rename, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { RunnerWorkspaceStatusSchema } from '@crewstation/contracts';
import { parseWorkspaceFiles } from '../src/workspace/gitStatus';
import { readWorkspaceStatus } from '../src/workspace/workspaceStatus';
import { gitWorkspaceFixture } from './gitWorkspaceFixture';

const fixtures: Array<Awaited<ReturnType<typeof gitWorkspaceFixture>>> = [];
const fixture = async (initialize = true) => { const value = await gitWorkspaceFixture(initialize); fixtures.push(value); return value; };
afterEach(async () => { await Promise.all(fixtures.splice(0).map((value) => value.dispose())); });

test('真实 HEAD、首次提交、游离 HEAD 与切换分支；查询不写 index 或工作文件', async () => {
  const f = await fixture();
  expect(await f.status()).toMatchObject({ status: 'ready', headSha: null, branch: 'main', uncommittedCount: 0 });
  await f.write('hello.txt', 'initial\n');
  const head = await f.commit('初始提交');
  const indexBefore = await Bun.file(join(f.root, '.git/index')).arrayBuffer();
  const status = RunnerWorkspaceStatusSchema.parse(await f.status());
  expect(status).toMatchObject({ status: 'ready', headSha: head, branch: 'main', shallow: false, unpushed: { count: 1, commits: [{ sha: head, subject: '初始提交' }] } });
  expect(await Bun.file(join(f.root, '.git/index')).arrayBuffer()).toEqual(indexBefore);
  await f.git.checked(['checkout', '--detach', head]);
  expect(await f.status()).toMatchObject({ branch: null, headSha: head });
  await f.git.checked(['checkout', '-b', 'another']);
  expect(await f.status()).toMatchObject({ branch: 'another', headSha: head });
});

test('暂存／未暂存／未跟踪／重命名／删除／二进制；空格中文换行路径原样返回', async () => {
  const f = await fixture();
  for (const file of ['both.txt', 'before.txt', 'removed.txt']) await f.write(file, 'old\n');
  await f.commit('base');
  await f.write('both.txt', 'staged\n');
  await rename(join(f.root, 'before.txt'), join(f.root, '改名 后.txt'));
  await rm(join(f.root, 'removed.txt'));
  await f.git.checked(['add', '.']);
  await f.write('both.txt', 'unstaged\n');
  await f.write(' 前后空格 \n中文.txt ', 'new\n');
  await f.write('binary.bin', new Uint8Array([0, 1, 2, 3]));
  const status = await f.status();
  expect(status.status).toBe('ready');
  if (status.status !== 'ready') return;
  expect(status.uncommittedCount).toBe(5);
  expect(status.uncommitted).toContainEqual({ path: 'both.txt', status: 'MM', index: 'M', worktree: 'M' });
  expect(status.uncommitted).toContainEqual({ path: '改名 后.txt', originalPath: 'before.txt', status: 'R.', index: 'R', worktree: '.' });
  expect(status.uncommitted.some((file) => file.path === ' 前后空格 \n中文.txt ')).toBe(true);
  expect(status.uncommitted.some((file) => file.path === 'removed.txt' && file.index === 'D')).toBe(true);
  expect(status.unpushed).toMatchObject({ count: 1 });
});

test('同样行数／同样大小的再次编辑和 symlink 变化都会使比较指纹失效', async () => {
  const f = await fixture();
  await f.write('file.txt', 'zero\n');
  await f.commit('base');
  await f.write('file.txt', 'aaaa\n');
  const first = await f.status();
  await f.write('file.txt', 'bbbb\n');
  const second = await f.status();
  expect(first.status === 'ready' && second.status === 'ready' && first.fingerprint !== second.fingerprint).toBe(true);
  await symlink('file.txt', join(f.root, 'link'));
  const third = await f.status();
  expect(second.status === 'ready' && third.status === 'ready' && third.fingerprint !== second.fingerprint).toBe(true);
});

test('上游差距与全部本地分支未推送独立计算，不拿当前分支冒充全部工作', async () => {
  const f = await fixture();
  const base = await f.commit('base');
  await f.git.checked(['update-ref', 'refs/remotes/origin/main', base]);
  await f.git.checked(['config', 'remote.origin.url', 'https://example.invalid/repo.git']);
  await f.git.checked(['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
  await f.git.checked(['branch', '--set-upstream-to=origin/main']);
  const current = await f.commit('current');
  await f.git.checked(['checkout', '-b', 'other', base]);
  await f.commit('other');
  await f.git.checked(['checkout', 'main']);
  const status = await f.status();
  expect(status).toMatchObject({ status: 'ready', headSha: current, upstream: { status: 'ready', name: 'origin/main', ahead: 1, behind: 0 }, unpushed: { status: 'ready', count: 2 } });
});

test('浅历史、非 Git 目录、失败退出码和截断不会伪装为干净／零提交', async () => {
  const empty = await fixture(false);
  expect(await empty.status()).toMatchObject({ status: 'unavailable' });
  const f = await fixture();
  const head = await f.commit('base');
  await Bun.write(join(f.root, '.git/shallow'), `${head}\n`);
  expect(await f.status()).toMatchObject({ status: 'ready', shallow: true, unpushed: { status: 'unavailable' } });
  const failure = await readWorkspaceStatus({ checked: async () => { throw new Error('truncated'); }, run: f.git.run }, f.paths);
  expect(failure).toMatchObject({ status: 'unavailable', reason: 'truncated' });
});

test('清单有界，但完整文件数量保留；未提交文件不会增加提交数量', async () => {
  const f = await fixture();
  await f.commit('base');
  for (let i = 0; i < 503; i++) await f.write(`file-${i}.txt`, `${i}`);
  const status = await f.status();
  expect(status).toMatchObject({ status: 'ready', uncommittedCount: 503, uncommittedTruncated: true, unpushed: { count: 1 } });
  expect(status.status === 'ready' && status.uncommitted.length).toBe(500);
});

test('不完整的 Git 状态拒绝解析，不能丢掉有问题的记录后报告干净', () => {
  expect(() => parseWorkspaceFiles('broken\0')).toThrow('无法识别');
  expect(() => parseWorkspaceFiles('2 R. N... 100644 100644 100644 a b R100 renamed\0')).toThrow('重命名状态不完整');
});
