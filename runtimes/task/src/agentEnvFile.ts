import { readFile, stat } from 'node:fs/promises';
import type { Logger } from '@crewstation/kernel';

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 读取模型凭据文件（`KEY=VALUE` 行，支持 `export ` 前缀、`#` 注释与成对引号）。
 * 只记录键的数量与行号，任何情况下都不记录值。
 */
export async function readAgentEnvFile(path: string, logger: Logger): Promise<Record<string, string>> {
  const info = await stat(path);
  if ((info.mode & 0o077) !== 0) logger.warn('agent env file is readable by group or others', { path, mode: (info.mode & 0o777).toString(8) });
  const text = await readFile(path, 'utf8');
  const entries = parseEnvLines(text, (line, reason) => logger.warn('agent env file line ignored', { path, line, reason }));
  logger.info('agent env file loaded', { path, keys: Object.keys(entries).length });
  return entries;
}

export function parseEnvLines(text: string, onInvalid: (line: number, reason: string) => void = () => undefined): Record<string, string> {
  const entries: Record<string, string> = {};
  text.split('\n').forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) return;
    const body = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eq = body.indexOf('=');
    if (eq <= 0) return onInvalid(index + 1, 'missing =');
    const key = body.slice(0, eq).trim();
    if (!KEY_RE.test(key)) return onInvalid(index + 1, 'invalid key');
    entries[key] = unquote(body.slice(eq + 1).trim());
  });
  return entries;
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}
