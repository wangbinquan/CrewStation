import type { ClusterOperation, ClusterResource } from '@crewstation/contracts';
export interface SlotControl {
  apply(operation: ClusterOperation, replicas?: number): Promise<void>;
  observe(operation: ClusterOperation, replicas?: number): Promise<{ done: boolean; failed?: boolean; reason: string; replicas: number; readyReplicas: number }>;
  inspect(target: ClusterResource): Promise<void>;
}
