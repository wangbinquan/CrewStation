import { isApiClientError } from '../../../shared/api/useApi';

/**
 * 发布前置检查失败（412）意味着工作区有未提交改动，平台因此不打标签。
 * 服务端把文件清单放在 details.uncommitted 里，页面要把它列出来而不是只显示一行错误。
 * 返回 undefined 表示这次失败不是前置检查失败。
 */
export function uncommittedPaths(error: unknown): readonly string[] | undefined {
  if (!isApiClientError(error) || error.kind !== 'precondition') return undefined;
  const value = error.details.uncommitted;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}
