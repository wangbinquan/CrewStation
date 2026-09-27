import type { Actor, ProjectId, UserId } from '@crewstation/contracts';

/** 用户域认证需要的项目事实；正式版授权结果由项目模块定义并原样透传。 */
export interface ProjectHostDirectory<Verdict> {
  resolveServiceIdentity(identity: string): Promise<{ readonly projectId: ProjectId } | undefined>;
  isAdmin(userId: UserId): Promise<boolean>;
  roleOf(actor: Actor, projectId: ProjectId): Promise<string | undefined>;
  appAccessBySlug(user: { readonly id: UserId; readonly isAdmin: boolean }, slug: string): Promise<Verdict>;
}
