import type { BusinessDeletionOrigin } from '../../domain/deletion/content';

/** Original identities from public Project and TaskRuntime APIs, supplied by the composition root. */
export interface BusinessDeletionSources {
  resolve(kind: 'service' | 'task', key: string, representation: 'current' | 'legacy'): Promise<BusinessDeletionOrigin | undefined>;
}
