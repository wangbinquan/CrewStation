import type { ProjectId, ServiceId, TaskId, TaskInputManifest, TaskInputObject } from '@crewstation/contracts';
import type { ObjectServiceApi } from './objectServiceApi';

export interface TaskInputCaller { id: string; token: string; podUid: string }
export interface TaskInputApi {
  prepare(input: { projectId: ProjectId; serviceId: ServiceId; taskId: TaskId; generation: number; items: readonly TaskInputObject[] }): Promise<void>;
  commit(taskId: TaskId, generation: number): Promise<void>;
  abort(taskId: TaskId, generation: number, retryable: boolean): Promise<void>;
  bind(consumerId: string, podUid: string): Promise<void>;
  environment(input: { taskId: TaskId; generation: number; consumerId: string }): Promise<Record<string, string>>;
  manifest(caller: TaskInputCaller): Promise<TaskInputManifest>;
  download(caller: TaskInputCaller, objectId: string, signal: AbortSignal): ReturnType<ObjectServiceApi['download']>;
  complete(caller: TaskInputCaller): Promise<void>;
}
