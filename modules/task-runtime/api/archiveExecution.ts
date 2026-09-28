import type { BusinessStorageFinalization } from '@crewstation/contracts';

export interface ArchiveExecutionApi {
  ensure(input: BusinessStorageFinalization, purpose?: 'archive' | 'binding'): Promise<{ id: string; state: 'queued' | 'admitted' | 'stopping' | 'stopped' }>;
  stop(input: BusinessStorageFinalization): Promise<boolean>;
  values(id: string): Promise<Readonly<Record<string, string>>>;
  bind(id: string, podUid: string, secretUid: string): Promise<void>;
  reconcile(): Promise<void>;
}
