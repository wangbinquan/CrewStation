import { readFile } from 'node:fs/promises';
import { validation } from '@crewstation/kernel';
import type { ManagedRuntimeContext } from '../../contract/managedRuntime';
import type { RunDirectory } from '../../process/runDirectory';
import { stripJsonComments } from '../../process/jsonc';

type Json = Record<string, unknown>;
type HookGroups = Array<Record<string, unknown>>;

/** 管理员 settings.json（Hook 写出的文件）：允许 JSONC 注释；读不到或不是对象即 cli_config_invalid。 */
export async function readManagedClaudeSettings(managed: ManagedRuntimeContext | undefined): Promise<Json | undefined> {
  if (managed?.configFile?.kind !== 'claude-settings') return undefined;
  let text: string;
  try { text = await readFile(managed.configFile.path, 'utf8'); }
  catch (error) { throw validation(`读取管理员 settings.json 失败（${managed.configFile.path}）：${error instanceof Error ? error.message : String(error)}`, { code: 'cli_config_invalid', path: managed.configFile.path }); }
  let parsed: unknown;
  try { parsed = JSON.parse(stripJsonComments(text)); } catch (error) { throw validation(`管理员 settings.json 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`, { code: 'cli_config_invalid', path: managed.configFile.path }); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw validation('管理员 settings.json 必须是 JSON 对象', { code: 'cli_config_invalid', path: managed.configFile.path });
  return parsed as Json;
}

/**
 * 只传一个最终 `--settings` 文件（RFC-004 §6）：管理员内容为底，平台观测 hooks 按事件**追加**到管理员的同名事件组之后。
 * 其他键一律保留管理员的值；平台不写 sandbox、不动 env。
 */
export function mergeClaudeSettings(admin: Json | undefined, platformHooks: Record<string, HookGroups> | undefined): Json {
  const merged: Json = { ...(admin ?? {}) };
  if (!platformHooks) return merged;
  const adminHooks = typeof merged.hooks === 'object' && merged.hooks !== null && !Array.isArray(merged.hooks) ? { ...(merged.hooks as Record<string, unknown>) } : {};
  for (const [event, groups] of Object.entries(platformHooks)) {
    const existing = adminHooks[event];
    adminHooks[event] = Array.isArray(existing) ? [...existing, ...groups] : groups;
  }
  merged.hooks = adminHooks;
  return merged;
}

/** 有任何一方需要写 settings 时才写文件并返回路径；两边都没有就不传 `--settings`。 */
export async function writeMergedClaudeSettings(runDir: RunDirectory, admin: Json | undefined, platformHooks: Record<string, HookGroups> | undefined): Promise<string | undefined> {
  if (!admin && !platformHooks) return undefined;
  return runDir.write('settings.json', JSON.stringify(mergeClaudeSettings(admin, platformHooks)));
}
