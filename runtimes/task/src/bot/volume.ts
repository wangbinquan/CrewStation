import { chown, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BotContextStorage } from '@crewstation/contracts';
import { BOT_VOLUME_DIRECTORY, BotContextStorageSchema, botContextPaths } from '@crewstation/contracts';
import { RunnerCommandError, fsErrorCode } from '../commandError';

const invalid = (): never => { throw new RunnerCommandError('bot_context_invalid', 'Bot 原生上下文目录或归属不匹配，未创建替代上下文'); };

/** The root-owned ancestors and receipt directory never enter the worker's mount. */
export async function prepareBotVolume(root: string, workerUid: number, input: BotContextStorage, workerGid = workerUid): Promise<void> {
  const storage = BotContextStorageSchema.parse(input), owner = process.getuid?.() ?? invalid();
  if (!Number.isSafeInteger(workerUid) || workerUid < 1) invalid();
  const info = await lstat(root);
  if (!info.isDirectory() || info.uid !== owner) invalid();
  if ((await readdir(root)).some((name) => name !== BOT_VOLUME_DIRECTORY && name !== 'lost+found')) invalid();
  const paths = botContextPaths(storage.ownerTaskId, storage.conversationId, storage.epoch), create = storage.mode === 'create';
  for (const part of [BOT_VOLUME_DIRECTORY, paths.owner, paths.conversation, paths.context]) await directory(join(root, part), owner, create);
  for (const [part, allowed] of [[BOT_VOLUME_DIRECTORY, storage.ownerTaskId], [paths.owner, storage.conversationId]] as const) {
    if ((await readdir(join(root, part))).some((name) => name !== allowed)) invalid();
  }
  const marker = join(root, paths.context, 'identity.json');
  const identity = JSON.stringify({ version: 1, ownerTaskId: storage.ownerTaskId, conversationId: storage.conversationId, epoch: storage.epoch, volumeUid: storage.volumeUid });
  if (create) {
    try { await writeFile(marker, identity, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (fsErrorCode(error) !== 'EEXIST') throw error; }
  }
  const markerInfo = await lstat(marker).catch(() => invalid());
  if (!markerInfo.isFile() || markerInfo.uid !== owner || (markerInfo.mode & 0o077) !== 0 || await readFile(marker, 'utf8') !== identity) invalid();
  await directory(join(root, paths.receipts), owner, create);
  const native = join(root, paths.native);
  if (create) {
    try { await mkdir(native, { mode: 0o700 }); }
    catch (error) { if (fsErrorCode(error) !== 'EEXIST') throw error; }
    const current = await lstat(native);
    if (current.isDirectory() && current.uid === owner && (await readdir(native)).length === 0) await chown(native, workerUid, workerGid);
  }
  await directory(native, workerUid, false);
}

async function directory(path: string, uid: number, create: boolean): Promise<void> {
  if (create) {
    try { await mkdir(path, { mode: 0o700 }); }
    catch (error) { if (fsErrorCode(error) !== 'EEXIST') throw error; }
  }
  const info = await lstat(path).catch(() => invalid());
  if (!info.isDirectory() || info.uid !== uid || (info.mode & 0o077) !== 0) invalid();
}

export async function prepareBotVolumeCommand(args: string[]): Promise<void> {
  if (process.getuid?.() !== 0 || args.length !== 3) invalid();
  await prepareBotVolume(args[0]!, Number(args[1]), BotContextStorageSchema.parse(JSON.parse(args[2]!)));
}
