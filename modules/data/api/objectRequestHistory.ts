import type { ProjectId } from '@crewstation/contracts';

/** Internal original callback facts. This history grants neither mutations nor physical absence. */
export interface ObjectRequestHistory {
  readonly projectId: ProjectId; readonly retainedRecordsComplete: true; readonly revision: string;
  readonly records: readonly {
    readonly id: string; readonly kind: 'put' | 'get' | 'verify' | 'remove' | 'inspect'; readonly state: 'running' | 'finished';
    readonly origin: { readonly projectId: ProjectId; readonly serviceId: string; readonly spaceId: string; readonly attemptId: string;
      readonly backendId: string; readonly placementRevision: number; readonly key: string; readonly size: number;
      readonly process: { readonly podUid: string; readonly containerId: string; readonly nodeUid: string; readonly nodeName: string;
        readonly pid: number; readonly startTicks: string; readonly pidNamespace: string; readonly bootId: string } };
    readonly exitDigest: string | null; readonly recoveryDigest: string | null;
  }[];
}
