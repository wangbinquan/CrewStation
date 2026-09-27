import type { TaskId } from '@crewstation/contracts';
import { afterEach, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BUSINESS_VOLUME_DIRECTORY, businessStoragePaths } from '@crewstation/contracts';
import { prepareBusinessVolume } from './businessVolume';

const ownerTaskId = '01a0bf5d-8f4b-7001-8458-107366e7de39', runnerTaskId = '01a0bf5d-8f4b-7001-8458-107366e7de40';
const roots: string[] = [];
const owner = process.getuid!(), group = process.getgid!();
const input = (root: string, initialize = true) => ({ root, ownerTaskId, runnerTaskId: ownerTaskId, workerUid: owner || 10001, workerGid: owner ? group : 10001, initialize });
async function directory() { const root = await mkdtemp(join(tmpdir(), 'cs-business-volume-')); roots.push(root); return root; }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true }); });

test('初始化与保卷恢复保留内容；Agent 共用工作路径而日志按 Runner 分开', async () => {
  const root = await directory(), paths = businessStoragePaths(ownerTaskId, ownerTaskId);
  await prepareBusinessVolume(input(root));
  await writeFile(join(root, paths.work, 'sentinel'), 'workspace-data');
  await writeFile(join(root, paths.journal, 'sentinel'), 'execution-data');
  await prepareBusinessVolume(input(root, false));
  await prepareBusinessVolume({ ...input(root, false), runnerTaskId });
  const child = businessStoragePaths(ownerTaskId, runnerTaskId);
  expect(child.work).toBe(paths.work); expect(child.journal).not.toBe(paths.journal);
  expect(await readFile(join(root, paths.work, 'sentinel'), 'utf8')).toBe('workspace-data');
  expect(await readFile(join(root, paths.journal, 'sentinel'), 'utf8')).toBe('execution-data');
  for (const path of [paths.root, paths.runners, paths.journal, child.journal]) {
    const info = await stat(join(root, path)); expect(info.uid).toBe(owner); expect(info.mode & 0o777).toBe(0o700);
  }
  expect((await stat(join(root, paths.work))).uid).toBe(input(root).workerUid);
});

test('缺少原布局或私有目录时不建替代目录，旧卷和另一父任务卷都拒绝', async () => {
  const root = await directory();
  await expect(prepareBusinessVolume(input(root, false))).rejects.toThrow('拒绝创建');
  await writeFile(join(root, 'old-v2-data'), 'keep');
  await expect(prepareBusinessVolume(input(root))).rejects.toThrow('归属');
  expect(await readFile(join(root, 'old-v2-data'), 'utf8')).toBe('keep');
  const valid = await directory(); await prepareBusinessVolume(input(valid));
  await expect(prepareBusinessVolume({ ...input(valid), ownerTaskId: runnerTaskId, runnerTaskId })).rejects.toThrow('归属');
  const paths = businessStoragePaths(ownerTaskId, ownerTaskId);
  await rm(join(valid, paths.journal), { recursive: true });
  await expect(prepareBusinessVolume(input(valid, false))).rejects.toThrow('拒绝创建');
});

test('拒绝链接、公开私有目录、路径注入和子执行擅自初始化', async () => {
  const root = await directory(), outside = await directory();
  await symlink(outside, join(root, BUSINESS_VOLUME_DIRECTORY));
  await expect(prepareBusinessVolume(input(root))).rejects.toThrow('归属');
  await expect(prepareBusinessVolume({ ...input(root), ownerTaskId: '../escape' })).rejects.toThrow();
  await expect(prepareBusinessVolume({ ...input(root), runnerTaskId })).rejects.toThrow('归属');
  const valid = await directory(); await prepareBusinessVolume(input(valid));
  await chmod(join(valid, businessStoragePaths(ownerTaskId, ownerTaskId).runners), 0o777);
  await expect(prepareBusinessVolume(input(valid, false))).rejects.toThrow('归属');
});

test('初始化在创建布局目录后中断可恢复，不能把非法 worker UID 写入卷', async () => {
  const root = await directory(); await mkdir(join(root, BUSINESS_VOLUME_DIRECTORY), { mode: 0o700 });
  await prepareBusinessVolume(input(root));
  await prepareBusinessVolume(input(root));
  await expect(prepareBusinessVolume({ ...input(root), workerUid: 0 })).rejects.toThrow('归属');
});

test('原生会话随独立 Agent 挂载，恢复只复用原目录且不创建空会话', async () => {
  const root = await directory(); await prepareBusinessVolume(input(root));
  const session = { key: runnerTaskId as TaskId, mode: 'create' as const };
  await prepareBusinessVolume({ ...input(root, false), runnerTaskId, session });
  const home = join(root, businessStoragePaths(ownerTaskId, runnerTaskId).sessions, runnerTaskId);
  await writeFile(join(home, 'native.db'), 'conversation');
  await prepareBusinessVolume({ ...input(root, false), runnerTaskId, session: { ...session, mode: 'existing' } });
  expect(await readFile(join(home, 'native.db'), 'utf8')).toBe('conversation');
  await expect(prepareBusinessVolume({ ...input(root, false), session })).rejects.toThrow('归属');
  await rm(home, { recursive: true });
  await expect(prepareBusinessVolume({ ...input(root, false), runnerTaskId, session: { ...session, mode: 'existing' } })).rejects.toThrow('拒绝创建');
  await expect(stat(home)).rejects.toThrow();
});
