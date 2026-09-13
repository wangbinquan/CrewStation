import { isApiClientError } from '../../../shared/api/useApi';

/**
 * 发布前置检查可能因为文件、来源变化或连接失败而拒绝。
 * 只提取服务端 details.uncommitted 文件清单，其他前置条件保留各自的错误原因。
 */
export function uncommittedPaths(error: unknown): readonly string[] | undefined {
  if (!isApiClientError(error) || error.kind !== 'precondition') return undefined;
  const value = error.details.uncommitted;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}
