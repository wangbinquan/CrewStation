import type { Actor, ProjectId, ServiceId } from '@crewstation/contracts';

export interface ProjectAuthorizer {
  authorize(actor: Actor, projectId: ProjectId, action: 'view' | 'develop' | 'approve-data-access'): Promise<unknown>;
}

export interface ServiceResolver {
  resolveServiceById(serviceId: ServiceId): Promise<{ projectId: ProjectId; slug: string } | undefined>;
}

export interface DataSettings {
  /** 供给使用的默认套餐名（首版只是记录，不限制容量）。 */
  readonly defaultPlan: string;
}
