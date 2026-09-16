import type { RuntimeCheckId, RuntimeConfigId, RuntimeConfigListQuery, UserId } from '@crewstation/contracts';
import type { RuntimeCheck } from '../domain/runtimeCheck';
import type { RuntimeConfig, RuntimeCredential, RuntimeRevision } from '../domain/runtimeConfig';

export interface RuntimeConfigRepository {
  insert(config: RuntimeConfig): Promise<void>;
  update(config: RuntimeConfig): Promise<void>;
  getById(id: RuntimeConfigId): Promise<RuntimeConfig | undefined>;
  /** 事务内锁住配置行，串行化草稿保存、启用与停用。 */
  lockById(id: RuntimeConfigId): Promise<RuntimeConfig | undefined>;
  getByName(name: string): Promise<RuntimeConfig | undefined>;
  /** 按名字排序的有界分页；after 为上一页最后一个名字。 */
  listPage(filter: Pick<RuntimeConfigListQuery, 'name' | 'driver'> & { enabled?: boolean }, limit: number, after?: string): Promise<RuntimeConfig[]>;
}

export interface RuntimeRevisionRepository {
  insert(revision: RuntimeRevision): Promise<void>;
  get(configId: RuntimeConfigId, revision: number): Promise<RuntimeRevision | undefined>;
}

export interface RuntimeCredentialRepository {
  list(configId: RuntimeConfigId): Promise<RuntimeCredential[]>;
  upsert(credential: RuntimeCredential): Promise<void>;
  remove(configId: RuntimeConfigId, name: string): Promise<void>;
}

export interface RuntimeCheckRepository {
  insert(check: RuntimeCheck): Promise<void>;
  update(check: RuntimeCheck): Promise<void>;
  get(checkId: RuntimeCheckId): Promise<RuntimeCheck | undefined>;
  findByRequest(configId: RuntimeConfigId, createdBy: UserId, clientRequestId: string): Promise<RuntimeCheck | undefined>;
  /** 某版本内容的最近一次检查（任何状态）。 */
  latestFor(configId: RuntimeConfigId, revision: number, contentHash: string): Promise<RuntimeCheck | undefined>;
}

export const RUNTIME_CHECK_JOB_KIND = 'agent-runtime.check';
