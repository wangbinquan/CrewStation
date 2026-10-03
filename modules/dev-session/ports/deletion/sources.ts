import type { DevelopmentDeletionOrigin } from '../../domain/deletion/content';

/** Composition provides public TaskRuntime and ClusterManagement original identity ports. */
export interface DevelopmentDeletionSources {
  resolve(kind: 'project' | 'task' | 'cluster-operation', key: string, representation: 'current' | 'legacy'): Promise<DevelopmentDeletionOrigin | undefined>;
}
