import type { CurrentUserDto, DevSessionDto, ProjectDto } from '@crewstation/contracts';

export interface SessionAccess {
  /** 项目负责人或平台管理员。 */
  readonly isOwner: boolean;
  /** 会话是当前用户自己开的。 */
  readonly isMine: boolean;
  readonly canRelease: boolean;
  /** 负责人释放别人的会话必须带 force，界面上要显式确认。 */
  readonly needsForce: boolean;
}

function ownsProject(me: CurrentUserDto, project: ProjectDto | undefined): boolean {
  if (me.isAdmin) return true;
  if (project?.ownerUserId === me.id) return true;
  return me.memberships.some((membership) => membership.projectId === project?.id && membership.role === 'owner');
}

export function sessionAccess(me: CurrentUserDto | undefined, project: ProjectDto | undefined, session: DevSessionDto | undefined): SessionAccess {
  if (me === undefined) return { isOwner: false, isMine: false, canRelease: false, needsForce: false };
  const isOwner = ownsProject(me, project);
  const isMine = session !== undefined && session.createdBy === me.id;
  return { isOwner, isMine, canRelease: isMine || isOwner, needsForce: isOwner && !isMine && session !== undefined };
}
