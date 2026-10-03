import type { RuntimeDeletionOrigin } from '../../domain/deletion/content';

/** Public immutable owners resolve service/project roots and accepted business tasks that were never provisioned. */
export interface RuntimeDeletionSources {
  resolve(kind: 'project' | 'service' | 'business-task', key: string, representation: 'current' | 'legacy'): Promise<RuntimeDeletionOrigin | undefined>;
}
