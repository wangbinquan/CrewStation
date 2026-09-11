import type { MemberRole, ProjectId, UserId } from '@crewstation/contracts';

/** 当前用户的项目成员关系；由 project 模块经装配提供，供 /v1/me 使用。 */
export interface MembershipLookup {
  membershipsOf(userId: UserId): Promise<Array<{ projectId: ProjectId; role: MemberRole }>>;
}
