/** 平台统一错误分类；HTTP 状态码映射在 packages/http，领域代码只关心 kind。 */
export type ErrorKind =
  | 'not_found' | 'conflict' | 'forbidden' | 'unauthenticated' | 'validation'
  | 'precondition' | 'quota_exceeded' | 'unavailable' | 'internal';

export class PlatformError extends Error {
  constructor(readonly kind: ErrorKind, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PlatformError';
  }
}

export function isPlatformError(error: unknown): error is PlatformError {
  return error instanceof PlatformError;
}

export const notFound = (what: string, id?: string): PlatformError =>
  new PlatformError('not_found', id ? `${what} ${id} 不存在` : `${what} 不存在`, id ? { id } : {});
export const conflict = (message: string, details?: Record<string, unknown>): PlatformError =>
  new PlatformError('conflict', message, details);
export const forbidden = (message = '无权执行此操作'): PlatformError => new PlatformError('forbidden', message);
export const unauthenticated = (message = '未登录'): PlatformError => new PlatformError('unauthenticated', message);
export const validation = (message: string, details?: Record<string, unknown>): PlatformError =>
  new PlatformError('validation', message, details);
export const precondition = (message: string, details?: Record<string, unknown>): PlatformError =>
  new PlatformError('precondition', message, details);
export const quotaExceeded = (message: string, details?: Record<string, unknown>): PlatformError =>
  new PlatformError('quota_exceeded', message, details);
