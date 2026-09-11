import type { ErrorKind } from '@crewstation/kernel';
import { isPlatformError } from '@crewstation/kernel';

/** 命令处理失败时回给 cs-session 的 `error { code, message }`；code 是协议级稳定字符串，工作台按它分支。 */
export class RunnerCommandError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'RunnerCommandError';
  }
}

export const pathDenied = (path: string): RunnerCommandError => new RunnerCommandError('path_denied', `路径 ${path} 不在工作目录内或形式不合法`);
export const notFound = (what: string): RunnerCommandError => new RunnerCommandError('not_found', `${what} 不存在`);
export const alreadyExists = (code: string, what: string): RunnerCommandError => new RunnerCommandError(code, `${what} 已存在`);

const KIND_TO_CODE: Record<ErrorKind, string> = {
  not_found: 'not_found',
  conflict: 'conflict',
  forbidden: 'forbidden',
  unauthenticated: 'unauthenticated',
  validation: 'validation',
  precondition: 'precondition',
  quota_exceeded: 'quota_exceeded',
  unavailable: 'unavailable',
  internal: 'internal_error',
};

/** 任意异常归一为协议错误：文件系统错误码按语义映射，其余归为 internal_error（消息不含路径以外的内部细节）。 */
export function toCommandError(error: unknown): RunnerCommandError {
  if (error instanceof RunnerCommandError) return error;
  if (isPlatformError(error)) return new RunnerCommandError(KIND_TO_CODE[error.kind], error.message);
  const code = fsErrorCode(error);
  if (code === 'ENOENT') return new RunnerCommandError('not_found', '路径不存在');
  if (code === 'ENOTDIR') return new RunnerCommandError('not_a_directory', '路径中有一段不是目录');
  if (code === 'EISDIR') return new RunnerCommandError('is_directory', '路径是目录');
  if (code === 'EACCES' || code === 'EPERM') return new RunnerCommandError('forbidden', '没有访问权限');
  return new RunnerCommandError('internal_error', error instanceof Error ? error.message : String(error));
}

export function fsErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}
