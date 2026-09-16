import { readFile } from 'node:fs/promises';
import { validation } from '@crewstation/kernel';
import type { ManagedRuntimeContext } from '../../contract/managedRuntime';
import type { RunDirectory } from '../../process/runDirectory';
import { stripJsonComments } from '../../process/jsonc';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

export async function readManagedOpencodeConfig(managed: ManagedRuntimeContext | undefined): Promise<Json | undefined> {
  if (managed?.configFile?.kind !== 'opencode-config') return undefined;
  let text: string;
  try { text = await readFile(managed.configFile.path, 'utf8'); }
  catch (error) { throw validation(`读取管理员 opencode 配置失败（${managed.configFile.path}）：${error instanceof Error ? error.message : String(error)}`, { code: 'cli_config_invalid', path: managed.configFile.path }); }
  let parsed: unknown;
  try { parsed = JSON.parse(stripJsonComments(text)); } catch (error) { throw validation(`管理员 opencode 配置不是合法 JSON：${error instanceof Error ? error.message : String(error)}`, { code: 'cli_config_invalid', path: managed.configFile.path }); }
  if (!isObject(parsed)) throw validation('管理员 opencode 配置必须是 JSON 对象', { code: 'cli_config_invalid', path: managed.configFile.path });
  return parsed;
}

/**
 * 管理员模板为底，平台叠加受控项（RFC-004 §6）：对象递归合并，平台标量与数组优先；
 * `plugin` 追加去重；`provider.<p>` 保留管理员的 options／baseURL／models，只覆盖平台的 whitelist。
 */
export function mergeOpencodeConfig(admin: Json | undefined, platform: Json): Json {
  return deepMerge(admin ?? {}, platform) as Json;
}

function deepMerge(base: unknown, overlay: unknown, key?: string): unknown {
  if (Array.isArray(base) && Array.isArray(overlay) && key === 'plugin') return [...new Set([...base, ...overlay])];
  if (!isObject(base) || !isObject(overlay)) return overlay;
  const out: Json = { ...base };
  for (const [k, value] of Object.entries(overlay)) out[k] = k in base ? deepMerge(base[k], value, k) : value;
  return out;
}

/**
 * 托管模式：合成后的完整配置写成一个文件并经 OPENCODE_CONFIG 显式指定；OPENCODE_CONFIG_CONTENT 继续携带平台叠加层，
 * 由 CLI 最后合并，因此即使文件被改也不会丢掉平台受控项。
 */
export async function materializeOpencodeConfig(env: Record<string, string>, managed: ManagedRuntimeContext | undefined, runDir: RunDirectory): Promise<void> {
  const admin = await readManagedOpencodeConfig(managed);
  if (!managed || !admin) return;
  const platform = JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? '{}') as Json;
  env.OPENCODE_CONFIG = await runDir.write('opencode.json', JSON.stringify(mergeOpencodeConfig(admin, platform)));
}
