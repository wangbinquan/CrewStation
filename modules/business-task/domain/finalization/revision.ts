import type { AcceptedArchiveRevision } from '@crewstation/contracts';

export interface FinalizationRevision extends AcceptedArchiveRevision {
  readonly digest: string;
  readonly state: 'pending' | 'applied' | 'rejected';
  readonly errorCode?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
