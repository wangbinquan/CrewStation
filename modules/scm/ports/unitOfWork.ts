import type { RepositoryBindingRepository, SessionCredentialRepository } from './repositories';

/** 一个事务内可用的全部仓储；用例层只通过它访问持久化。 */
export interface RepositoryScope {
  readonly bindings: RepositoryBindingRepository;
  readonly credentials: SessionCredentialRepository;
}

export interface UnitOfWork {
  /** 只读访问，不开事务。 */
  readonly read: RepositoryScope;
  run<T>(fn: (scope: RepositoryScope) => Promise<T>): Promise<T>;
}
