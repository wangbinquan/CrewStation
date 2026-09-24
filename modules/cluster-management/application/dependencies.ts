import type { Clock, Logger } from '@crewstation/kernel';
import type { Actor, UserId } from '@crewstation/contracts';
import type { ClusterReader, ClusterMetadata, DomainOperations, LedgerClaims } from '../ports/cluster';
import type { ClusterRepository } from '../ports/repository';
import type { SystemComponent } from '../domain/inventory';
export interface ClusterDeps { resolveReleaseId?: (legacy: string) => Promise<string | undefined>; repository: ClusterRepository; cluster: ClusterReader; metadata: ClusterMetadata; domains: DomainOperations; isAdmin(id: UserId): Promise<boolean>; /** 项目成员读本项目盘点的授权（RFC-019）：由组合根接 project 模块的 develop 动作，测试员与非成员在这里被拒。 */ authorizeProject(actor: Actor, projectId: string): Promise<void>; clock: Clock; systemNamespace: string; catalog: SystemComponent[]; wait(ms: number): Promise<void>; observationMs: number; /** 资源中心的认领叠加（RFC-025 T13）；没接时清单只按快照。 */ ledger?: LedgerClaims; logger?: Logger }
