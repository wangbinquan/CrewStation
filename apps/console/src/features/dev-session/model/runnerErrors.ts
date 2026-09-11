import { StreamCommandError } from './streamCommandQueue';

/**
 * writeFile 的 expectedVersion 不匹配时 TaskRunner 回 error 帧，但协议没有约定统一的 code，
 * 因此这里按已知的几种写法识别；识别不出来的按普通错误展示，绝不静默覆盖磁盘上的新内容。
 */
const CONFLICT_CODES: ReadonlySet<string> = new Set(['conflict', 'version_conflict', 'stale_version', 'precondition', 'precondition_failed']);

export function isStreamCommandError(error: unknown): error is StreamCommandError {
  return error instanceof StreamCommandError;
}

export function isVersionConflict(error: unknown): boolean {
  return isStreamCommandError(error) && CONFLICT_CODES.has(error.code);
}

/** 把命令错误渲染成一行：优先服务端 message，其次 code。 */
export function streamErrorMessage(error: unknown): string {
  if (isStreamCommandError(error)) return error.message || error.code;
  return error instanceof Error ? error.message : String(error);
}
