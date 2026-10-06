import type { BusinessDeletionOrigin } from '../../domain/deletion/content';
import type { ProjectDeletionCurrentAssets } from '@crewstation/contracts';

/** Original identities from public Project and TaskRuntime APIs, supplied by the composition root. */
export interface BusinessDeletionSources {
  readonly currentAssets?: ProjectDeletionCurrentAssets;
  resolve(kind: 'service' | 'task', key: string, representation: 'current' | 'legacy'): Promise<BusinessDeletionOrigin | undefined>;
}
