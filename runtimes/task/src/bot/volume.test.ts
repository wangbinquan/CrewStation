import { afterEach, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BotContextStorage, TaskId } from '@crewstation/contracts';
import { BOT_VOLUME_DIRECTORY, botContextPaths } from '@crewstation/contracts';
import { prepareBotVolume as prepare } from './volume';
const prepareBotVolume = (root: string, worker: number, value: BotContextStorage) => prepare(root, worker, value, process.getuid!() ? process.getgid!() : worker);

const roots: string[] = [], uid = process.getuid!() || 10001;
const storage: BotContextStorage = { version: 1, ownerTaskId: '01a0bf5d-8f4b-7001-8458-107366e7de39' as TaskId, conversationId: '01a0bf5d-8f4b-7001-8458-107366e7de40', epoch: 1, pvcName: 'bot-01a0bf5d8f4b70018458107366e7de39', volumeUid: 'original-uid', mode: 'create' };
async function directory() { const root = await mkdtemp(join(tmpdir(), 'cs-bot-volume-')); roots.push(root); return root; }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test('private native data survives executions and fresh epochs retain old data', async () => {
  const root = await directory(), paths = botContextPaths(storage.ownerTaskId, storage.conversationId, 1);
  await prepareBotVolume(root, uid, storage);
  await writeFile(join(root, paths.native, 'native.db'), 'original-context');
  await prepareBotVolume(root, uid, { ...storage, mode: 'existing' });
  await prepareBotVolume(root, uid, { ...storage, epoch: 2 });
  expect(await readFile(join(root, paths.native, 'native.db'), 'utf8')).toBe('original-context');
  expect((await stat(join(root, paths.native))).mode & 0o777).toBe(0o700);
  expect((await stat(join(root, paths.receipts))).uid).toBe(process.getuid!());
  await expect(prepareBotVolume(root, uid, { ...storage, volumeUid: 'replacement' })).rejects.toThrow('归属');
});
test('lost directories, unsafe modes, foreign identities and symbolic links fail closed', async () => {
  const empty = await directory();
  await expect(prepareBotVolume(empty, uid, { ...storage, mode: 'existing' })).rejects.toThrow();
  const linked = await directory(); await symlink(empty, join(linked, BOT_VOLUME_DIRECTORY));
  await expect(prepareBotVolume(linked, uid, storage)).rejects.toThrow();
  const root = await directory(); await prepareBotVolume(root, uid, storage);
  await expect(prepareBotVolume(root, uid, { ...storage, conversationId: '../escape' })).rejects.toThrow();
  const paths = botContextPaths(storage.ownerTaskId, storage.conversationId, 1);
  await chmod(join(root, paths.receipts), 0o755);
  await expect(prepareBotVolume(root, uid, { ...storage, mode: 'existing' })).rejects.toThrow();
  await chmod(join(root, paths.receipts), 0o700);
  await rm(join(root, paths.native), { recursive: true });
  await expect(prepareBotVolume(root, uid, { ...storage, mode: 'existing' })).rejects.toThrow();
  await expect(stat(join(root, paths.native))).rejects.toThrow();
});
