import type { Actor, DevelopmentSummary, HealthDto, ProjectId, ProjectPage, ProjectPageEntry, ProjectPageQuery, ReleaseDto, ServiceId, SlotDto, TrafficSwitchDto } from '@crewstation/contracts';

/** 只读公开接口，由 platform 装配；不读取其他模块的表，也不请求 Runner。 */
export interface ProjectSummarySources {
  list(actor: Actor, query: ProjectPageQuery): Promise<ProjectPage>;
  read(actor: Actor, ids: readonly ProjectId[]): Promise<ProjectPageEntry[]>;
  get(actor: Actor, projectId: ProjectId): Promise<ProjectPageEntry>;
  session(projectId: ProjectId): Promise<(Omit<DevelopmentSummary, 'taskId' | 'createdBy'> & {
    id: string; projectId: ProjectId; serviceId: string; kind: 'dev-session' | 'business'; createdBy?: string;
  }) | undefined>;
  slots(actor: Actor, serviceId: ServiceId): Promise<SlotDto[]>;
  preview(actor: Actor, serviceId: ServiceId): Promise<SlotDto | null>;
  health(actor: Actor, projectId: ProjectId): Promise<HealthDto[]>;
  releases(actor: Actor, serviceId: ServiceId): Promise<ReleaseDto[]>;
  switches(actor: Actor, serviceId: ServiceId): Promise<TrafficSwitchDto[]>;
}
