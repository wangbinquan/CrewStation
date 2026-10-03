import type { ProjectDeletionContext, ProjectId } from '@crewstation/contracts';
import type { DevelopmentWorkCallback, DevelopmentWorkInput, DevelopmentWorkPod, DevelopmentWorkProcess } from '../../domain/deletion/work';
import type { DevelopmentDeletionSources } from './sources';

export interface DevelopmentWorkProcesses {
  protectCurrent(): Promise<DevelopmentWorkProcess>;
  sweep(accept: { stopped(process: Pick<DevelopmentWorkProcess, 'podUid' | 'containerId' | 'nodeUid' | 'nodeName'>, digest: string): Promise<void>;
    podStopped(process: DevelopmentWorkPod, digest: string): Promise<void>; releasable(podUid: string): Promise<boolean> }): Promise<void>;
}
export interface DevelopmentWorkSources extends DevelopmentDeletionSources {
  readonly processes: DevelopmentWorkProcesses;
  assertAvailable(project: ProjectId): Promise<void>;
  assertGrant(context: ProjectDeletionContext): Promise<void>;
}
/** Each bounded HTTP response and its outstanding effects have independent durable original lifetimes. */
export interface DevelopmentProjectWork {
  run<T>(input: DevelopmentWorkInput, callback: () => Promise<T>): Promise<T>;
  /** A response deadline does not close its guard: the private lifetime still awaits all already-started child effects. */
  runResponse<T>(input: DevelopmentWorkInput, callback: () => Promise<T>): Promise<T>;
  runOrigin<T>(input: Omit<DevelopmentWorkInput, 'projectId'>, callback: () => Promise<T>): Promise<T>;
  runOriginResponse<T>(input: Omit<DevelopmentWorkInput, 'projectId'>, callback: () => Promise<T>): Promise<T>;
  effect<T>(inputDigest: string, callback: () => Promise<T>): Promise<T>;
  whenActive<T>(inputDigest: string, callback: () => Promise<T>): Promise<T>;
  history(project: ProjectId): Promise<readonly DevelopmentWorkCallback[]>;
  observe(): Promise<void>;
  drain(): Promise<void>;
}
