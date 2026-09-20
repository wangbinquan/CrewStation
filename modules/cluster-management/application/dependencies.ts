import type { Clock } from '@crewstation/kernel';
import type { UserId } from '@crewstation/contracts';
import type { ClusterReader, ClusterMetadata, DomainOperations } from '../ports/cluster';
import type { ClusterRepository } from '../ports/repository';
import type { SystemComponent } from '../domain/inventory';
export interface ClusterDeps { resolveReleaseId?: (legacy: string) => Promise<string | undefined>; repository: ClusterRepository; cluster: ClusterReader; metadata: ClusterMetadata; domains: DomainOperations; isAdmin(id: UserId): Promise<boolean>; clock: Clock; systemNamespace: string; catalog: SystemComponent[]; wait(ms: number): Promise<void>; observationMs: number }
