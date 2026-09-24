import type { Actor, MemberRole, ProjectId, UserId } from '@crewstation/contracts';
import type { AppAccessFacts } from '../domain/appAccess';
import type { AppListing } from '../domain/appListing';
import type { Project } from '../domain/project';
import type { Service } from '../domain/service';

export interface VisibleApplication {
  project: Project;
  service: Service | undefined;
  listing: AppListing;
  role: MemberRole | undefined;
}
export interface AppListingRepository {
  get(projectId: ProjectId): Promise<AppListing>;
  /** expectedRevision 不匹配返回 undefined；新增与更新均是数据库原子 CAS。 */
  save(listing: AppListing, expectedRevision: number): Promise<AppListing | undefined>;
  /** SQL 先按当前用户可见性过滤，再搜索和按稳定 ID 分页；不读全企业项目到应用层过滤。 */
  visible(actor: Actor, query: { projectId?: ProjectId; after?: ProjectId; q: string; limit: number }): Promise<VisibleApplication[]>;
  /** 网关每个正式地址请求都走这里：项目、可见范围与这个人的成员角色一次联查取齐；查不到项目返回 undefined。 */
  accessFacts(target: { slug: string } | { projectId: ProjectId }, userId: UserId): Promise<{ project: Project; facts: AppAccessFacts } | undefined>;
}
