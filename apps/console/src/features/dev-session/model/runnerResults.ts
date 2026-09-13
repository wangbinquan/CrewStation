import type { ListFilesResult, PreviewStatusResult, ReadFileResult, WriteFileResult } from '@crewstation/api-client';
import type { FileEntry, PreviewState } from '@crewstation/contracts';
import { StreamCommandError } from './streamCommandQueue';

/**
 * result 帧的 payload 是 unknown：这里只做结构收窄，不引 zod。
 * 形状由同一仓库的 TaskRunner 产生，收窄失败说明协议不一致，按命令失败处理而不是渲染半个界面。
 */
function record(payload: unknown, command: string): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null) throw new StreamCommandError('malformed_result', `${command} 返回了非对象结果`);
  return payload as Record<string, unknown>;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function count(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function fileEntries(value: unknown): FileEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is FileEntry => typeof entry === 'object' && entry !== null && typeof (entry as FileEntry).name === 'string');
}

export function asListFilesResult(payload: unknown): ListFilesResult {
  const value = record(payload, 'listFiles');
  return { path: text(value.path, '.'), entries: fileEntries(value.entries) };
}

export function asReadFileResult(payload: unknown): ReadFileResult {
  const value = record(payload, 'readFile');
  if (typeof value.path !== 'string' || !value.path || typeof value.content !== 'string') throw new StreamCommandError('malformed_result', 'readFile 未返回有效路径与文本，未替换编辑器草稿');
  return { path: text(value.path), content: text(value.content), version: text(value.version), size: count(value.size) };
}

export function asWriteFileResult(payload: unknown): WriteFileResult {
  const value = record(payload, 'writeFile');
  return { path: text(value.path), version: text(value.version) };
}

const PREVIEW_STATES: readonly PreviewState[] = ['disabled', 'stopped', 'starting', 'ready', 'crashed'];

export function asPreviewStatusResult(payload: unknown): PreviewStatusResult {
  const value = record(payload, 'previewStatus');
  const state = PREVIEW_STATES.find((candidate) => candidate === value.state);
  if (!state || !Number.isSafeInteger(value.restarts) || Number(value.restarts) < 0) throw new StreamCommandError('malformed_result', 'previewStatus 未返回有效预览状态，结果未确认');
  const port = typeof value.port === 'number' ? { port: value.port } : {};
  const lastError = typeof value.lastError === 'string' ? { lastError: value.lastError } : {};
  return { state, restarts: count(value.restarts), ...port, ...lastError };
}
