import type { ProjectId, ResourceTarget, ResourceValues } from '@crewstation/contracts';

export interface ObjectResourceCommand { projectId: ProjectId; operationId: string; target: ResourceTarget; expectedRevision: string; values: ResourceValues }
export interface ObjectResourceReceipt { hash: string; revision: string; effect: string; applied: boolean }
