import type { ClusterOperation, ClusterInspection } from '@crewstation/contracts';
export interface SlotMaintenance { operation: ClusterOperation; inspection: ClusterInspection; state: 'prepared' | 'applied' | 'done' | 'failed'; replicas?: number; error?: string }
export interface ClusterSlotProjection { serviceId: string; physical: 'blue' | 'green'; role: 'prod' | 'preview'; releaseId?: string; state: string; manifestReplicas?: number; overrideReplicas?: number; plan?: string; revision: string }
