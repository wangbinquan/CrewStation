import type { Actor, AppIcon, AppVisibilityCheckDto, AppVisibilityMode, MemberRole, ProjectId, UserId } from '@crewstation/contracts';

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

export function appVisibilityBasis(actor: Actor, role: MemberRole | undefined, listing: AppListing): AppVisibilityCheckDto['basis'] {
  if (actor.isAdmin) return 'admin';
  if (role) return 'member';
  if (listing.mode === 'authenticated') return 'authenticated';
  if (listing.mode === 'selected' && listing.userIds.includes(actor.userId)) return 'selected';
  return 'hidden';
}
