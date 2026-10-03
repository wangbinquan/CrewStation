import type { ProjectId } from '@crewstation/contracts';
import type { InfrastructureOriginDocument, InfrastructureOriginReference } from '../domain/infrastructureOrigins';

export interface OriginalInfrastructureOrigin {
  readonly complete: true; readonly id: string; readonly scope: 'project'|'platform'; readonly projectIds: readonly ProjectId[];
  /** Original owner row/relationship digest. Current and legacy reads must identify the same unchanged source. */
  readonly revision: string;
}
export interface InfrastructureOriginSources {
  resolve(document: InfrastructureOriginDocument, reference: InfrastructureOriginReference, representation: 'current'|'legacy'): Promise<OriginalInfrastructureOrigin | undefined>;
}
