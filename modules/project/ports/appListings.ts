import type { Actor, MemberRole, ProjectId } from '@crewstation/contracts';
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
}
