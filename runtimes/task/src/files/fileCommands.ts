import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FileEntry, RunnerEvent } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import { RunnerCommandError, fsErrorCode, notFound } from '../commandError';
import type { CommandOf } from '../commandDispatcher';
import type { ProcessLauncher } from '../process/launcher';
import type { WorkdirPaths } from './workdirPath';

/** 协议以文本传内容；超过此上限的文件不经文件命令读取（工作台应改走下载通道）。 */
export const MAX_READ_BYTES = 8 * 1024 * 1024;

export interface ListFilesPayload { path: string; entries: FileEntry[] }
export interface ReadFilePayload { path: string; content: string; version: string; size: number }
export interface WriteFilePayload { path: string; version: string }

export interface FileCommands {
  list(command: CommandOf<'listFiles'>): Promise<ListFilesPayload>;
  read(command: CommandOf<'readFile'>): Promise<ReadFilePayload>;
  write(command: CommandOf<'writeFile'>): Promise<WriteFilePayload>;
}

export interface FileCommandDeps {
  paths: WorkdirPaths;
  launcher: ProcessLauncher;
  emit: (event: RunnerEvent) => void;
  logger: Logger;
}

/** 文件版本 = 内容 sha256 十六进制；写入时以 expectedVersion 做乐观并发。 */
export function contentVersion(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createFileCommands(deps: FileCommandDeps): FileCommands {
  return {
    async list(command) {
      const target = await deps.paths.resolveRelative(command.path);
      if (!target.exists) throw notFound(`目录 ${command.path}`);
      const names = await readdir(target.absolute);
      const entries = await Promise.all(names.map((name) => describeEntry(target.absolute, name)));
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return { path: target.relative, entries };
    },
    async read(command) {
      const target = await deps.paths.resolveRelative(command.path);
      if (!target.exists) throw notFound(`文件 ${command.path}`);
      const info = await stat(target.absolute);
      if (info.isDirectory()) throw new RunnerCommandError('is_directory', `${command.path} 是目录`);
      if (info.size > MAX_READ_BYTES) throw new RunnerCommandError('file_too_large', `${command.path} 超过 ${MAX_READ_BYTES} 字节`);
      const bytes = await readFile(target.absolute);
      return { path: target.relative, content: bytes.toString('utf8'), version: contentVersion(bytes), size: bytes.byteLength };
    },
    async write(command) {
      const target = await deps.paths.resolveRelative(command.path);
      const existing = target.exists ? await stat(target.absolute) : undefined;
      if (existing?.isDirectory()) throw new RunnerCommandError('is_directory', `${command.path} 是目录`);
      await checkExpectedVersion(command, target.absolute, existing !== undefined);
      await ensureParentDirs(dirname(target.absolute), deps);
      const bytes = Buffer.from(command.content, 'utf8');
      await writeAtomically(target.absolute, bytes, existing ? existing.mode & 0o777 : 0o644, deps.launcher);
      deps.emit({ kind: 'fileChanged', path: target.relative });
      deps.logger.debug('file written', { path: target.relative, bytes: bytes.byteLength });
      return { path: target.relative, version: contentVersion(bytes) };
    },
  };
}

async function describeEntry(dir: string, name: string): Promise<FileEntry> {
  const info = await lstat(join(dir, name));
  const kind: FileEntry['kind'] = info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other';
  return { name, kind, size: info.size, modifiedAt: info.mtime.toISOString() };
}

async function checkExpectedVersion(command: CommandOf<'writeFile'>, absolute: string, exists: boolean): Promise<void> {
  if (command.expectedVersion === undefined) return;
  const actual = exists ? contentVersion(await readFile(absolute)) : undefined;
  if (actual !== command.expectedVersion) {
    throw new RunnerCommandError('version_conflict', `文件 ${command.path} 已被修改（当前版本 ${actual ?? '不存在'}），请先重新读取`);
  }
}

/** 逐级创建缺失的父目录，root 运行时把新建目录的属主交给 worker。 */
async function ensureParentDirs(dir: string, deps: FileCommandDeps): Promise<void> {
  const created: string[] = [];
  let probe = dir;
  while (!(await exists(probe))) {
    created.push(probe);
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  if (created.length === 0) return;
  await mkdir(dir, { recursive: true });
  for (const path of created.reverse()) await deps.launcher.chownToWorker(path);
}

async function writeAtomically(absolute: string, bytes: Uint8Array, mode: number, launcher: ProcessLauncher): Promise<void> {
  const temp = `${absolute}.cs-tmp-${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(temp, bytes, { mode });
    await launcher.chownToWorker(temp);
    await rename(temp, absolute);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (fsErrorCode(error) === 'ENOENT' || fsErrorCode(error) === 'ENOTDIR') return false;
    throw error;
  }
}
