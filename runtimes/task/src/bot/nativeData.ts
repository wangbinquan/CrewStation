import { Database } from 'bun:sqlite';
import { lstatSync } from 'node:fs';
import { lstat, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { BotContextStorage } from '@crewstation/contracts';
import type { ProcessLauncher } from '../process/launcher';
import { RunnerCommandError, fsErrorCode } from '../commandError';

const invalid = (message: string): never => { throw new RunnerCommandError('bot_context_unavailable', message); };
/** A constant path inside each isolated Bot Pod keeps tool-output references valid across attempts. */
export const BOT_NATIVE_SCRATCH = '/tmp/crewstation-bot-native';

/** Only data is durable. HOME, auth, config, plugin installation and credential injection stay ephemeral. */
export async function prepareBotNativeData(input: { root: string; scratch?: string; home: string; storage: BotContextStorage; protocol: string; sessionId?: string; launcher: ProcessLauncher }): Promise<Record<string, string>> {
  if (input.protocol !== 'opencode') invalid('此协议尚未验证原生数据与凭据分离，不能使用持续 Bot 上下文');
  const root = await lstat(input.root).catch(() => invalid('原生上下文目录已丢失'));
  if (!root.isDirectory() || (root.mode & 0o077) !== 0) invalid('原生上下文目录不安全');
  const dbPath = join(input.root, 'opencode.db');
  if (input.storage.mode === 'existing') {
    if (!input.sessionId) invalid('恢复缺少原生 session 标识');
    verifyNativeSession(dbPath, input.sessionId!);
  } else if (input.sessionId) invalid('新上下文不能使用其他原生 session');
  const scratch = input.scratch ?? BOT_NATIVE_SCRATCH, data = join(scratch, 'data'), native = join(data, 'opencode');
  for (const path of [scratch, data, native]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0) invalid('原生临时目录不安全');
    await input.launcher.chownToWorker(path);
  }
  for (const name of ['tool-output', 'snapshot', 'storage']) {
    const target = join(input.root, name);
    await mkdir(target, { mode: 0o700 }).catch((error) => { if (fsErrorCode(error) !== 'EEXIST') throw error; });
    const info = await lstat(target);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0) invalid('原生数据目录不安全');
    await input.launcher.chownToWorker(target);
    // Scratch is unique to this Pod. Never accept a pre-existing user-controlled link.
    await symlink(target, join(native, name));
  }
  return { HOME: input.home, XDG_DATA_HOME: data, XDG_CONFIG_HOME: join(input.home, '.config'), XDG_STATE_HOME: join(scratch, 'state'), XDG_CACHE_HOME: join(scratch, 'cache'), OPENCODE_DB: dbPath };
}

export function verifyNativeSession(path: string, sessionId: string): void {
  let db: Database | undefined;
  try {
    const file = lstatSync(path);
    if (!file.isFile() || file.isSymbolicLink()) invalid('原生上下文数据库路径不安全');
    db = new Database(path, { readonly: true });
    if (!db.query('SELECT id FROM session WHERE id = ?').get(sessionId)) invalid('原生 session 已丢失；旧聊天记录仍可查看');
    const integrity = db.query('PRAGMA quick_check').get() as { quick_check: string };
    if (integrity.quick_check !== 'ok') invalid('原生上下文数据库损坏');
  } catch (error) {
    if (error instanceof RunnerCommandError) throw error;
    invalid('原生上下文数据库不可读或版本不兼容');
  } finally { db?.close(); }
}
