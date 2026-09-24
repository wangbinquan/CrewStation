import type { ProjectId, UserId } from '@crewstation/contracts';
import type { AccessRequest } from '../domain/accessRequest';

export interface AccessRequestPageQuery {
  readonly projectId?: ProjectId;
  readonly state: 'pending' | 'approved' | 'rejected' | 'all';
  readonly limit: number;
  /** 上一页最后一条；按创建时间倒序、同一时刻按 ID 倒序续读。 */
  readonly before?: { readonly id: string; readonly createdAt: Date };
}

export interface AccessRequestRepository {
  /** 同一人对同一应用已有待处理的申请时不写入并返回 false；并发提交由部分唯一索引兜住。 */
  insert(request: AccessRequest): Promise<boolean>;
  /** 只在仍待处理时写入裁决；已被别人处理过返回 false。 */
  decide(request: AccessRequest): Promise<boolean>;
  getById(id: string): Promise<AccessRequest | undefined>;
  /** 本人对该应用最近的一条申请。 */
  latest(projectId: ProjectId, userId: UserId): Promise<AccessRequest | undefined>;
  listPage(query: AccessRequestPageQuery): Promise<AccessRequest[]>;
}
