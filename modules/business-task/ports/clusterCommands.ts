import type { ClusterOperation } from '@crewstation/contracts';
export interface ClusterCommand { operation: ClusterOperation; phase: 'prepared' | 'paused' | 'applied'; resultId?: string }
export interface ClusterCommands { get(id: string): Promise<ClusterCommand | undefined>; save(command: ClusterCommand): Promise<void>; withLock<T>(taskId: string, run: () => Promise<T>): Promise<T> }
