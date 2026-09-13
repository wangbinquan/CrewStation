import type { Actor, ProjectId, ProjectPageEntry, ProjectPageQuery } from '@crewstation/contracts';

/** project 自己的只读投影；授权、筛选、服务与角色联查后再 LIMIT。 */
export interface ProjectPageRepository {
  list(actor: Actor, query: Pick<ProjectPageQuery, 'q' | 'kind' | 'state' | 'ownerUserId'> & {
    limit: number; after?: ProjectId; ids?: readonly ProjectId[];
  }): Promise<ProjectPageEntry[]>;
}
