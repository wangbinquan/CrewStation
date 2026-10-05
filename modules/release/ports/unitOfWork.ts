import type { HandoffRepository } from './executionHandoff';
import type { PhysicalSlot, ServiceSlots } from '../domain/slots';
import type { JobProjection, JobRecordRef, SlotRecordRef } from './ledger';
import type { MaintenanceRepository } from './repositories';
import type { DomainPayload, DomainTopicName, ServiceId } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectDeletionEvidence, ProjectDeletionInventory, ProjectDeletionTarget } from '@crewstation/contracts';
import type { ReleaseCallbackRecord, ReleaseDeletionContent, ReleaseDeletionScope, ReleasePhysicalScope } from '../domain/release';
import type { OfflinePolicyRepository, ReleaseRepository, SlotEventRepository, SlotRepository, TrafficSwitchRepository } from './repositories';

export interface DomainEventPublisher {
  publish<T extends DomainTopicName>(topic: T, payload: DomainPayload<T>): Promise<void>;
}

export interface RepositoryScope {
  readonly handoffs: HandoffRepository;
  readonly maintenance: MaintenanceRepository;
  readonly releases: ReleaseRepository;
  readonly slots: SlotRepository;
  readonly switches: TrafficSwitchRepository;
  readonly slotEvents: SlotEventRepository;
  readonly offlinePolicy: OfflinePolicyRepository;
  readonly events: DomainEventPublisher;
  /**
   * 配了资源台账（RFC-025）时：sync 在当前事务里把一个服务的两个槽投影进台账（保存槽时仓储已自动投影，补投影才直接调它）；
   * slot 读一个物理槽的台账记录（读不到当作没有）。
   */
  readonly ledger?: {
    sync(slots: ServiceSlots): Promise<void>;
    slot(serviceId: ServiceId, physical: PhysicalSlot): Promise<SlotRecordRef | undefined>;
    /** 构建、迁移 Job 投影进台账（包在保存点里，写失败只告警）。 */
    job(job: JobProjection): Promise<void>;
    /** 读一次发布的构建或迁移 Job 记录（读不到当作没有）；放弃资源中心建的 Job 时报 Failed（T8）。 */
    jobRecord(releaseId: string, kind: JobProjection['kind']): Promise<JobRecordRef | undefined>;
    failJob(releaseId: string, kind: JobProjection['kind'], message: string): Promise<void>;
  };
}

export interface UnitOfWork {
  readonly read: RepositoryScope;
  run<T>(fn: (scope: RepositoryScope) => Promise<T>): Promise<T>;
}

export interface ReleaseProjectAdmissions {
  run<T>(projectId: string, serviceId: string, input: { kind: ReleaseCallbackRecord['kind']; consumerId: string; inputDigest: string }, work: () => Promise<T>): Promise<T>;
  check(projectId: string, serviceId: string): Promise<void>;
  checkCurrent(): Promise<void>;
}
export type ReleasePhysicalReport = Pick<ProjectDeletionInventory, 'complete' | 'blockers' | 'references'>;
export type ReleasePhysicalProof =
  | { kind: 'waiting'; reason: string }
  | { kind: 'blocked'; blockers: ProjectDeletionInventory['blockers'] }
  | { kind: 'done'; digest: string; scopeDigest: string; sourceIdentity: string; independent: boolean; producersClosed: boolean; consumersStopped: boolean;
      nativeRemaining: number; storageRemaining: number; callbackExits: readonly { id: string; originalIdentity: string; digest: string }[] };
export interface ReleaseDeletionPhysics {
  capture(target: ProjectDeletionTarget, content: ReleaseDeletionContent): Promise<ReleasePhysicalReport & { scope: ReleasePhysicalScope | null }>;
  inspect(scope: ReleasePhysicalScope): Promise<ReleasePhysicalReport>;
  stop(context: ProjectDeletionContext, scope: ReleasePhysicalScope): Promise<ReleasePhysicalProof>;
  purge(context: ProjectDeletionContext, scope: ReleasePhysicalScope): Promise<ReleasePhysicalProof>;
  prove(scope: ReleasePhysicalScope, context?: ProjectDeletionContext): Promise<ReleasePhysicalProof>;
}
export interface ReleaseDeletionStored {
  scope: ReleaseDeletionScope; verified: boolean; phaseIndex: number;
  receipts: Readonly<Partial<Record<ProjectDeletionContext['phase'], ProjectDeletionEvidence>>>;
}
export interface ReleaseDeletionRepository {
  content(target: ProjectDeletionTarget): Promise<ReleaseDeletionContent>;
  retained(target: ProjectDeletionTarget): Promise<ReleaseDeletionScope | undefined>;
  seal(context: ProjectDeletionContext, scope: ReleaseDeletionScope): Promise<boolean | 'waiting'>;
  load(context: ProjectDeletionContext): Promise<ReleaseDeletionStored>;
  callbacksExited(context: ProjectDeletionContext): Promise<boolean>;
  recoverCallbacks(context: ProjectDeletionContext, proof: Extract<ReleasePhysicalProof, { kind: 'done' }>): Promise<void>;
  advance(context: ProjectDeletionContext, evidence: ProjectDeletionEvidence): Promise<void>;
  purgeMetadata(context: ProjectDeletionContext): Promise<ProjectDeletionEvidence>;
}
