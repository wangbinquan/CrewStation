import { afterEach, expect, test } from 'bun:test';
import { readFile, rename, rm } from 'node:fs/promises';
import { CommitWorkspaceInputSchema } from '@crewstation/contracts';
import { commitWorkspace } from '../src/workspace/commitWorkspace';
import { gitWorkspaceFixture } from './gitWorkspaceFixture';

const fixtures: Awaited<ReturnType<typeof gitWorkspaceFixture>>[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(fixture => fixture.dispose())); });
async function fixture() { const f = await gitWorkspaceFixture(); fixtures.push(f); await f.write('app.txt', 'base'); await f.commit('initial'); return f; }
async function confirmation(f: Awaited<ReturnType<typeof fixture>>) {
  const status = await f.status(); if (status.status !== 'ready') throw new Error(status.reason);
  return { ...CommitWorkspaceInputSchema.parse({ expectedHead: status.headSha, expectedBranch: status.branch, expectedFingerprint: status.fingerprint, message: 'Review app changes' }), actorUserId: '01a0bf5d-8f4b-7793-867c-efd7527b386b' };
}

test('提交已确认的暂存、重命名、新文件及删除；旧确认不会再次提交', async () => {
  const f = await fixture(); await f.write('removed', 'remove'); await f.commit('second');
  await rename(`${f.root}/app.txt`, `${f.root}/改名 \n.txt`); await f.git.checked(['add', '-A']);
  await f.write('new file.txt', 'new'); await rm(`${f.root}/removed`);
  const input = await confirmation(f), result = await commitWorkspace(f, input);
  expect(result.workspace).toMatchObject({ status: 'ready', headSha: result.commitSha, uncommittedCount: 0 });
  expect(await f.git.checked(['show', 'HEAD:new file.txt'])).toBe('new');
  expect(await f.git.checked(['show', 'HEAD:改名 \n.txt'])).toBe('base');
  expect((await f.git.checked(['log', '-1', '--format=%ae'])).trim()).toBe(`${input.actorUserId}@users.crewstation.invalid`);
  await expect(commitWorkspace(f, input)).rejects.toMatchObject({ code: 'workspace_changed' });
  expect((await f.git.checked(['rev-list', '--count', 'HEAD'])).trim()).toBe('3');
});

test('同路径相同行数的后续编辑使确认失效，原 index 和文件均保留', async () => {
  const f = await fixture(); await f.write('app.txt', 'first'); await f.git.checked(['add', 'app.txt']);
  const input = await confirmation(f), index = await readFile(`${f.root}/.git/index`);
  await f.write('app.txt', 'other');
  await expect(commitWorkspace(f, input)).rejects.toMatchObject({ code: 'workspace_changed' });
  expect(await readFile(`${f.root}/.git/index`)).toEqual(index);
  expect(await readFile(`${f.root}/app.txt`, 'utf8')).toBe('other');
  expect((await f.git.checked(['rev-parse', 'HEAD'])).trim()).toBe(input.expectedHead);
});

test('生成候选期间内容变化不覆盖暂存区，也不移动 HEAD', async () => {
  const f = await fixture(); await f.write('app.txt', 'reviewed'); const input = await confirmation(f), index = await readFile(`${f.root}/.git/index`);
  const git = { ...f.git, run: async (...args: Parameters<typeof f.git.run>) => { const result = await f.git.run(...args); if (args[0].includes('add')) await f.write('app.txt', 'later'); return result; } };
  await expect(commitWorkspace({ ...f, git }, input)).rejects.toMatchObject({ code: 'workspace_changed' });
  expect(await readFile(`${f.root}/.git/index`)).toEqual(index);
  expect((await f.git.checked(['rev-parse', 'HEAD'])).trim()).toBe(input.expectedHead);
});

test('其他 Git 操作持有 index.lock 时拒绝，不删除对方的锁', async () => {
  const f = await fixture(); await f.write('app.txt', 'reviewed'); const input = await confirmation(f);
  await f.write('.git/index.lock', 'other owner');
  await expect(commitWorkspace(f, input)).rejects.toMatchObject({ code: 'workspace_changed' });
  expect(await readFile(`${f.root}/.git/index.lock`, 'utf8')).toBe('other owner');
});

test('提交生成后再次编辑保留为未提交，不能被当作可发布快照', async () => {
  const f = await fixture(); await f.write('app.txt', 'reviewed'); const input = await confirmation(f);
  const git = { ...f.git, run: async (...args: Parameters<typeof f.git.run>) => { const result = await f.git.run(...args); if (args[0][0] === 'update-ref') await f.write('app.txt', 'next edit'); return result; } };
  const result = await commitWorkspace({ ...f, git }, input);
  expect(await f.git.checked(['show', 'HEAD:app.txt'])).toBe('reviewed');
  expect(result.workspace).toMatchObject({ status: 'ready', uncommittedCount: 1 });
  expect(await readFile(`${f.root}/app.txt`, 'utf8')).toBe('next edit');
});

test('合并进行中不走快捷提交，清单截断也拒绝提交', async () => {
  const f = await fixture(); await f.write('app.txt', 'reviewed'); const input = await confirmation(f);
  await f.write('.git/MERGE_HEAD', input.expectedHead);
  await expect(commitWorkspace(f, input)).rejects.toMatchObject({ code: 'workspace_changed' });
  await rm(`${f.root}/.git/MERGE_HEAD`);
  await Promise.all(Array.from({ length: 501 }, (_, i) => f.write(`new-${i}`, 'new')));
  await expect(commitWorkspace(f, await confirmation(f))).rejects.toMatchObject({ code: 'workspace_changed' });
});
