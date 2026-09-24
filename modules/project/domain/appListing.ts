import type { AppIcon, AppVisibilityMode, ProjectId } from '@crewstation/contracts';

export interface AppListing {
  projectId: ProjectId;
  description: string;
  icon: AppIcon;
  /** 市场可见与正式地址放行共用这一个范围（2026-09-24 起网关按它拦截）。 */
  mode: AppVisibilityMode;
  /** 没有使用权的人能不能在工作台申请；默认允许。 */
  allowRequests: boolean;
  revision: number;
  updatedAt: Date | null;
}

export function defaultAppListing(projectId: ProjectId): AppListing {
  return { projectId, description: '', icon: 'station', mode: 'members', allowRequests: true, revision: 0, updatedAt: null };
}
