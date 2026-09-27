import type { BusinessMaterialDto, BusinessMaterialRequest, TaskId } from '@crewstation/contracts';
import type { ExecutionAuthorization } from '../domain/executionControl';

export type MaterialContent = Omit<BusinessMaterialRequest, 'requestKey' | 'fence'>;
export interface StoredExecutionMaterial { serviceId: string; taskId: TaskId; requestKey: string; sealed: string; view: BusinessMaterialDto }
export interface ExecutionMaterials {
  find(serviceId: string, taskId: TaskId, requestKey: string): Promise<StoredExecutionMaterial | undefined>;
  get(serviceId: string, taskId: TaskId, materialId: string): Promise<StoredExecutionMaterial | undefined>;
  reserve(candidate: StoredExecutionMaterial, authorization: ExecutionAuthorization): Promise<StoredExecutionMaterial>;
}
