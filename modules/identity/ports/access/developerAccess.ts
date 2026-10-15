import type { DeveloperAccessPage, DeveloperAccessQuery, DeveloperAccessRequestDto, ResourceId, UserId } from '@crewstation/contracts';
import type { UserRepository } from '../userRepository';

export interface DeveloperAccessRepository {
  get(id: ResourceId): Promise<DeveloperAccessRequestDto | undefined>;
  latest(userId: UserId): Promise<DeveloperAccessRequestDto | undefined>;
  list(query: DeveloperAccessQuery): Promise<DeveloperAccessPage>;
  insert(request: DeveloperAccessRequestDto): Promise<void>;
  update(request: DeveloperAccessRequestDto, expectedRevision: number): Promise<void>;
}
export interface DeveloperAccessScope { users: UserRepository; requests: DeveloperAccessRepository }
export interface DeveloperAccessUnitOfWork {
  read: DeveloperAccessScope;
  /** 与平台角色修改共用跨进程锁；申请更新与角色授予在同一事务中。 */
  run<T>(userId: UserId, work: (scope: DeveloperAccessScope) => Promise<T>): Promise<T>;
}
