import type { ProjectDeletionContext, ProjectDeletionTarget } from '@crewstation/contracts';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import type { NativeProjectGrantPort, NativeWorkResourcePort, NativeWorkClusterPort, NativeWorkSource, RuntimeWorkContent, ReleaseWorkContent } from '../../../ports/deletion/nativeWork';
export type { NativeScmPort, RuntimeWorkContent, ReleaseWorkContent, CallbackProcess } from '../../../ports/deletion/nativeWork';
import type { PodWorkspaceHistory } from '../nativePodWorkspace/source';
import type { NodeProcessOwnerOrigin } from '../nodeProcessOwners';
import type { NodeConsumerBirthTransport } from '../nodeFileConsumers';

export type RuntimeWorkSource = NativeWorkSource<RuntimeWorkContent>;
export type ReleaseWorkSource = NativeWorkSource<ReleaseWorkContent>;
export interface NativeWorkOptions {
  k8s: K8sClient; systemNamespace: string; probePort: number; probeToken: string;
  consumerBirth?: NodeConsumerBirthTransport;
  project(): NativeProjectGrantPort; resources(): NativeWorkResourcePort; cluster(): NativeWorkClusterPort;
  fetch?: typeof fetch;
}
export interface WorkObject { kind: 'Pod' | 'Job' | 'Deployment' | 'ReplicaSet' | 'Secret' | 'ConfigMap'; namespace: string; name: string; uid: string; identity: string }
export interface WorkCatalog { mode: 'runtime-environment' | 'release'; target: ProjectDeletionTarget; consumerIds: string[]; objects: WorkObject[] }
export interface WorkNode { source: NodeProcessOwnerOrigin; owners: Array<{ key: string; podUid: string; containerId?: string }> }
export interface PodWorkHistory { catalog: WorkCatalog; workspaces: PodWorkspaceHistory[]; nodes: WorkNode[] }
export const objectKey = (row: Pick<WorkObject, 'kind' | 'namespace' | 'name'>) => JSON.stringify({ kind: row.kind, namespace: row.namespace, name: row.name });
export type NativeWorkGrant = (context: ProjectDeletionContext) => Promise<void>;
export type PodObject = K8sObject & { spec?: { nodeName?: string }; status?: { containerStatuses?: Array<{ containerID?: string }> } };
