import { isApiClientError } from '@crewstation/api-client';

/** 发布版本：递增级别或显式的 `v<major>.<minor>.<patch>`。 */
export const VERSION_BUMPS = ['patch', 'minor', 'major'] as const;
export type VersionBump = (typeof VERSION_BUMPS)[number];

export const RELEASE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isReleaseTag(value: string): boolean {
  return RELEASE_TAG_PATTERN.test(value);
}

/**
 * 发布前置检查失败（412）：details.uncommitted 是未提交文件的路径列表。
 * 返回空数组表示不是这种失败，调用方回退到普通错误提示。
 */
export function uncommittedPaths(error: unknown): string[] {
  if (!isApiClientError(error) || error.kind !== 'precondition') return [];
  const value = error.details.uncommitted;
  return Array.isArray(value) ? value.filter((path): path is string => typeof path === 'string') : [];
}
