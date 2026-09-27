export interface LegacyRecoveryItem {
  id: string; kind: string; state: 'open' | 'unknown'; taskId?: string; ownerPodUid?: string; createdAt: string;
  blockedBy: string[]; canStopRuntime: boolean;
}
export interface LegacyRecoveryResult { recovered: number; items: LegacyRecoveryItem[] }
