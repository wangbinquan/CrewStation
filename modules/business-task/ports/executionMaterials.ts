import type { BusinessExecutionFence, BusinessMaterialDownload, BusinessMaterialDto, BusinessMaterialObjectScope as MaterialObjectScope, BusinessMaterialRequest, TaskId } from '@crewstation/contracts';
import type { ExecutionAuthorization } from '../domain/executionControl';

export type MaterialContent = Omit<BusinessMaterialRequest, 'requestKey' | 'fence'>;
/** RFC-040: releasing/released only happen to materials that carry object pins. */
export type ExecutionMaterialState = 'preparing' | 'ready' | 'releasing' | 'released';
export interface StoredExecutionMaterial {
  state?: ExecutionMaterialState; pinRevision?: number; objectCount?: number | null;
  serviceId: string; taskId: TaskId; requestKey: string; sealed: string; view: BusinessMaterialDto;
}
export interface ExecutionMaterials {
  find(serviceId: string, taskId: TaskId, requestKey: string): Promise<StoredExecutionMaterial | undefined>;
  /** Published materials only; a released one is returned so callers can name the reason. */
  get(serviceId: string, taskId: TaskId, materialId: string): Promise<StoredExecutionMaterial | undefined>;
  publish(candidate: StoredExecutionMaterial, authorization: ExecutionAuthorization): Promise<StoredExecutionMaterial>;
  reserve(candidate: StoredExecutionMaterial, authorization: ExecutionAuthorization): Promise<StoredExecutionMaterial>;
  /** The original request key admits a released material again under a new pin revision. */
  revive(candidate: StoredExecutionMaterial, authorization: ExecutionAuthorization): Promise<StoredExecutionMaterial>;
  /** Interrupted releases and materials whose parent closed or whose last use is older than the retention. */
  releaseCandidates(limit: number, retentionDays: number): Promise<StoredExecutionMaterial[]>;
  recordObjectCount(material: StoredExecutionMaterial, count: number): Promise<void>;
  /** Rechecks eligibility under the service lock that also admits attempts; undefined means "still in use". */
  beginRelease(material: StoredExecutionMaterial, retentionDays: number): Promise<StoredExecutionMaterial | undefined>;
  completeRelease(material: StoredExecutionMaterial): Promise<void>;
}
/** Object pins are owned by the data module; each pin revision is released exactly once. */
export interface ExecutionMaterialObjects {
  pin(caller: { identity: string; token?: string }, input: MaterialObjectScope & { fence?: BusinessExecutionFence; revision?: number }): Promise<void>;
  check(input: MaterialObjectScope): Promise<void>;
  grants(input: MaterialObjectScope): Promise<BusinessMaterialDownload[]>;
  release(input: MaterialObjectScope & { revision: number }): Promise<void>;
}
