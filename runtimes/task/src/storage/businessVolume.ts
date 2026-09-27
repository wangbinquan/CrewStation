import { chmod, chown, lstat, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BUSINESS_VOLUME_DIRECTORY, BusinessSessionStorageSchema, businessSessionPath, businessStoragePaths } from '@crewstation/contracts';
import type { BusinessSessionStorage } from '@crewstation/contracts';
import { RunnerCommandError, fsErrorCode } from '../commandError';

interface VolumeInput { root: string; ownerTaskId: string; runnerTaskId: string; workerUid: number; workerGid?: number; initialize: boolean; session?: BusinessSessionStorage }
const invalid = (): never => { throw new RunnerCommandError('business_volume_invalid', '业务卷布局或归属不匹配，拒绝创建替代工作区'); };

/** 只在平台 init 容器中运行；长驻容器不挂载卷根，worker 无法重命名这两个 subPath。 */
export async function prepareBusinessVolume(input: VolumeInput): Promise<void> {
  const paths = businessStoragePaths(input.ownerTaskId, input.runnerTaskId), owner = process.getuid?.() ?? invalid();
  if (!Number.isSafeInteger(input.workerUid) || input.workerUid < 1 || (input.initialize && input.ownerTaskId !== input.runnerTaskId)) invalid();
  const root = await lstat(input.root);
  if (!root.isDirectory() || root.uid !== owner) invalid();
  const entries = await readdir(input.root);
  if (entries.some((name) => name !== BUSINESS_VOLUME_DIRECTORY && name !== 'lost+found')) invalid();
  const layout = join(input.root, BUSINESS_VOLUME_DIRECTORY);
  await privateDirectory(layout, owner, input.initialize);
  if ((await readdir(layout)).some((name) => name !== input.ownerTaskId)) invalid();
  await privateDirectory(join(input.root, paths.root), owner, input.initialize);
  const work = join(input.root, paths.work);
  if (input.initialize) {
    try { await mkdir(work, { mode: 0o700 }); }
    catch (error) { if (fsErrorCode(error) !== 'EEXIST') throw error; }
  }
  let working = await lstat(work).catch(() => invalid());
  // mkdir 成功而 chown 前崩溃的初始化可重入；只允许接管尚未使用的空目录。
  if (input.initialize && working.isDirectory() && working.uid === owner && (await readdir(work)).length === 0) {
    await chown(work, input.workerUid, input.workerGid ?? input.workerUid);
    working = await lstat(work);
  }
  if (!working.isDirectory() || working.uid !== input.workerUid) invalid();
  // 不递归 chown，保留业务文件的所有者和权限；私有目录绝不交给 worker。
  await chmod(work, 0o700);
  await privateDirectory(join(input.root, paths.runners), owner, input.initialize);
  await privateDirectory(join(input.root, paths.journal), owner, input.initialize || input.runnerTaskId !== input.ownerTaskId);
  await privateDirectory(join(input.root, paths.sessions), owner, input.initialize);
  if (input.session) await prepareSession(input);
}

async function prepareSession(input: VolumeInput): Promise<void> {
  const session = BusinessSessionStorageSchema.parse(input.session);
  if (input.ownerTaskId === input.runnerTaskId || (session.mode === 'create' && session.key !== input.runnerTaskId)) invalid();
  const path = join(input.root, businessSessionPath(input.ownerTaskId, session.key));
  if (session.mode === 'create') {
    try { await mkdir(path, { mode: 0o700 }); }
    catch (error) { if (fsErrorCode(error) !== 'EEXIST') throw error; }
    const info = await lstat(path);
    if (info.isDirectory() && info.uid === process.getuid?.() && (await readdir(path)).length === 0) await chown(path, input.workerUid, input.workerGid ?? input.workerUid);
  }
  const info = await lstat(path).catch(() => invalid());
  if (!info.isDirectory() || info.uid !== input.workerUid || (info.mode & 0o077) !== 0) invalid();
}

async function privateDirectory(path: string, owner: number, create: boolean): Promise<void> {
  if (create) {
    try { await mkdir(path, { mode: 0o700 }); }
    catch (error) { if (fsErrorCode(error) !== 'EEXIST') throw error; }
  }
  const info = await lstat(path).catch(() => invalid());
  if (!info.isDirectory() || info.uid !== owner || (info.mode & 0o077) !== 0) invalid();
}

export async function prepareBusinessVolumeCommand(args: string[]): Promise<void> {
  if (process.getuid?.() !== 0 || ![5, 7].includes(args.length) || !['initialize', 'existing'].includes(args[4]!)) invalid();
  await prepareBusinessVolume({ root: args[0]!, ownerTaskId: args[1]!, runnerTaskId: args[2]!, workerUid: Number(args[3]), initialize: args[4] === 'initialize', ...(args.length === 7 ? { session: BusinessSessionStorageSchema.parse({ key: args[5], mode: args[6] }) } : {}) });
}
