import type { EgressScope, ProjectId, RequestPageQuery } from '@crewstation/contracts';
import type { BlockedRecord } from '../domain/blockedRecord';
import type { EgressEntry } from '../domain/egressEntry';
import type { EgressRequest } from '../domain/egressRequest';

export interface EgressEntryRepository {
  insert(entry: EgressEntry): Promise<void>;
  getById(id: string): Promise<EgressEntry | undefined>;
  remove(id: string): Promise<void>;
  listAll(): Promise<EgressEntry[]>;
  /** 全局条目加该项目的项目级条目。 */
  listEffective(projectId: ProjectId): Promise<EgressEntry[]>;
  /** 同一作用域内同一 FQDN 只有一条；全局不带 projectId。 */
  find(fqdn: string, scope: EgressScope, projectId?: ProjectId): Promise<EgressEntry | undefined>;
}

export interface EgressRequestRepository {
  insert(request: EgressRequest): Promise<void>;
  update(request: EgressRequest): Promise<void>;
  getById(id: string): Promise<EgressRequest | undefined>;
  list(projectId?: ProjectId): Promise<EgressRequest[]>;
  listPage(query: Pick<RequestPageQuery, 'projectId' | 'state'> & { limit: number; before?: { createdAt: Date; id: string } }): Promise<EgressRequest[]>;
  findPending(projectId: ProjectId, fqdn: string): Promise<EgressRequest | undefined>;
}

export interface BlockedRecordRepository {
  get(projectId: ProjectId, fqdn: string): Promise<BlockedRecord | undefined>;
  upsert(record: BlockedRecord): Promise<void>;
  listByProject(projectId: ProjectId): Promise<BlockedRecord[]>;
}
