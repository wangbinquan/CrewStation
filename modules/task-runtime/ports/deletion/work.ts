import type { ProjectDeletionContext, ProjectId } from '@crewstation/contracts';
import type { RuntimeWorkCallback, RuntimeWorkInput, RuntimeWorkPod, RuntimeWorkProcess } from '../../domain/deletion/work';
import type { RuntimeDeletionSources } from './sources';

export interface RuntimeWorkProcesses {
  protectCurrent(): Promise<RuntimeWorkProcess>;
  sweep(accept: { stopped(process: Pick<RuntimeWorkProcess, 'podUid' | 'containerId' | 'nodeUid' | 'nodeName'>, digest: string): Promise<void>;
    podStopped(process: RuntimeWorkPod, digest: string): Promise<void>; releasable(podUid: string): Promise<boolean> }): Promise<void>;
}
export interface RuntimeWorkSources extends RuntimeDeletionSources {
  readonly processes: RuntimeWorkProcesses;
  assertAvailable(project: ProjectId): Promise<void>;
  assertGrant(context: ProjectDeletionContext): Promise<void>;
}
/** A private original finally retains effects even after the caller's HTTP or DB deadline. */
export interface RuntimeProjectWork {
  run<T>(input: RuntimeWorkInput, callback: () => Promise<T>): Promise<T>;
  runResponse<T>(input: RuntimeWorkInput, callback: () => Promise<T>): Promise<T>;
  runOrigin<T>(input: Omit<RuntimeWorkInput, 'projectId'>, callback: () => Promise<T>): Promise<T>;
  runOriginResponse<T>(input: Omit<RuntimeWorkInput, 'projectId'>, callback: () => Promise<T>): Promise<T>;
  /** Only the current project deletion phase may run sealed cleanup; ordinary APIs never receive this capability. */
  runGranted<T>(context: ProjectDeletionContext, input: Omit<RuntimeWorkInput, 'projectId' | 'kind'>, callback: () => Promise<T>): Promise<T>;
  effect<T>(inputDigest: string, callback: () => Promise<T>): Promise<T>;
  whenActive<T>(inputDigest: string, callback: () => Promise<T>): Promise<T>;
  history(project: ProjectId): Promise<readonly RuntimeWorkCallback[]>;
  observe(): Promise<void>;
  drain(): Promise<void>;
}
