import type { AppIcon, AppVisibilityMode, ProjectId, UserId } from '@crewstation/contracts';

export interface AppListing {
  projectId: ProjectId;
  description: string;
  icon: AppIcon;
  mode: AppVisibilityMode;
  userIds: UserId[];
  revision: number;
  updatedAt: Date | null;
}

export function defaultAppListing(projectId: ProjectId): AppListing {
  return { projectId, description: '', icon: 'station', mode: 'members', userIds: [], revision: 0, updatedAt: null };
}
