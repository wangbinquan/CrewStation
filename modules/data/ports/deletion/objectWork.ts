import type { ProjectId } from '@crewstation/contracts';
import type { ObjectByteLocation } from '../objectStorage';

export interface ObjectRequestProcess {
  readonly podUid: string; readonly containerId: string; readonly nodeUid: string; readonly nodeName: string;
  readonly pid: number; readonly startTicks: string; readonly pidNamespace: string; readonly bootId: string;
}
export interface ObjectRequestProcesses {
  protectCurrent(): Promise<ObjectRequestProcess>;
  sweep(accept: { stopped(process: Pick<ObjectRequestProcess, 'podUid' | 'containerId' | 'nodeUid' | 'nodeName'>, digest: string): Promise<void>;
    podStopped(process: Pick<ObjectRequestProcess, 'podUid' | 'nodeUid' | 'nodeName'>, digest: string): Promise<void>; releasable(podUid: string): Promise<boolean> }): Promise<void>;
}
export interface ObjectRequestOrigin extends ObjectByteLocation {
  readonly projectId: ProjectId; readonly serviceId: string; readonly spaceId: string; readonly attemptId: string; readonly size: number;
}
export interface ObjectRequestRunner {
  run<T>(location: ObjectByteLocation, kind: 'put' | 'get' | 'verify' | 'remove' | 'inspect', effect: (origin: ObjectRequestOrigin) => Promise<T>): Promise<T>;
}
