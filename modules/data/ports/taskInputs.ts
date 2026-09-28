import type { ProjectId, ServiceId, TaskId, TaskInputObject, TaskInputManifest } from '@crewstation/contracts';
import type { ObjectSource } from '../domain/objectStorage';

export interface PrepareTaskInputs { projectId: ProjectId; serviceId: ServiceId; taskId: TaskId; generation: number; items: readonly TaskInputObject[] }
export interface TaskInputsRecord extends PrepareTaskInputs {
  spaceId: string; digest: string; referenceRevision: number; state: 'prepared' | 'active' | 'aborted' | 'released';
  retryable: boolean; completedAt: string | null; items: TaskInputManifest['items'];
}
export interface TaskInputGrant { id: string; taskId: TaskId; generation: number; tokenHash: string; expiresAt: string; podUid: string | null }
export interface TaskInputRepository {
  prepare(input: PrepareTaskInputs): Promise<void>;
  commit(taskId: TaskId, generation: number): Promise<void>;
  abort(taskId: TaskId, generation: number, retryable: boolean): Promise<void>;
  issue(taskId: TaskId, generation: number, consumerId: string, tokenHash: string): Promise<void>;
  bind(consumerId: string, podUid: string): Promise<void>;
  authenticate(id: string, tokenHash: string, podUid: string): Promise<{ record: TaskInputsRecord; source: ObjectSource }>;
  complete(id: string, tokenHash: string, podUid: string): Promise<void>;
}
