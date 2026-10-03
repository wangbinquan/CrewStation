import type { ProjectDeletionContext, ProjectId } from '@crewstation/contracts';
import type { BusinessWorkCallback, BusinessWorkInput, BusinessWorkPod, BusinessWorkProcess } from '../../domain/deletion/work';
import type { BusinessDeletionSources } from './sources';

export interface BusinessWorkProcesses {
  protectCurrent(): Promise<BusinessWorkProcess>;
  sweep(accept: { stopped(process: Pick<BusinessWorkProcess, 'podUid' | 'containerId' | 'nodeUid' | 'nodeName'>, digest: string): Promise<void>;
    podStopped(process: BusinessWorkPod, digest: string): Promise<void>; releasable(podUid: string): Promise<boolean> }): Promise<void>;
}
export interface BusinessWorkSources extends BusinessDeletionSources {
  readonly processes: BusinessWorkProcesses;
  assertAvailable(projectId: ProjectId): Promise<void>;
  assertGrant(context: ProjectDeletionContext): Promise<void>;
}
/** Covers the original dispatch callback, including all awaited effects and its private finally. */
export interface BusinessProjectWork {
  callbackId(): string;
  retain<T>(pending: Promise<T>): Promise<T>;
  run<T>(input: BusinessWorkInput, callback: () => Promise<T>): Promise<T>;
  runService<T>(input: Omit<BusinessWorkInput, 'projectId'>, callback: () => Promise<T>): Promise<T>;
  checkCurrent(projectId: ProjectId, serviceId: string): Promise<void>;
  /** Await the original side effect and reject abandoned scopes before any subsequent effect. */
  effect<T>(callback: () => Promise<T>): Promise<T>;
  whenActive<T>(callback: () => Promise<T>): Promise<T>;
  history(projectId: ProjectId): Promise<readonly BusinessWorkCallback[]>;
  /** Sealing admission is not a completed deletion phase or a resource reclamation proof. */
  seal(context: ProjectDeletionContext): Promise<{ readonly pending: readonly string[] }>;
  observe(): Promise<void>;
}
