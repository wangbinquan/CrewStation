import type { MemberRole, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import type { ServicePlan, TaskProfile } from '../domain/plans';
import type { Project } from '../domain/project';
import type { TaskQuota } from '../domain/quota';
import type { Service } from '../domain/service';

export interface ProjectRepository {
  insert(project: Project): Promise<void>;
  update(project: Project): Promise<void>;
  getById(id: ProjectId): Promise<Project | undefined>;
  getBySlug(slug: string): Promise<Project | undefined>;
  list(page?: { after?: string; limit: number }): Promise<Project[]>;
  listByIds(ids: readonly ProjectId[]): Promise<Project[]>;
}

export interface ServiceRepository {
  list(projectIds?: readonly ProjectId[]): Promise<Service[]>;
  insert(service: Service): Promise<void>;
  getById(id: ServiceId): Promise<Service | undefined>;
  getByProject(projectId: ProjectId): Promise<Service | undefined>;
  getByIdentity(identity: string): Promise<Service | undefined>;
}

export interface Membership {
  readonly projectId: ProjectId;
  readonly userId: UserId;
  readonly role: MemberRole;
}

export interface MembershipRepository {
  list(projectId: ProjectId): Promise<Membership[]>;
  get(projectId: ProjectId, userId: UserId): Promise<Membership | undefined>;
  upsert(membership: Membership): Promise<void>;
  remove(projectId: ProjectId, userId: UserId): Promise<void>;
  listProjectIdsByUser(userId: UserId): Promise<ProjectId[]>;
  listByUser(userId: UserId): Promise<Membership[]>;
}

export interface QuotaRepository {
  get(projectId: ProjectId): Promise<TaskQuota | undefined>;
  upsert(quota: TaskQuota): Promise<void>;
}

export interface CatalogRepository {
  listServicePlans(): Promise<ServicePlan[]>;
  getServicePlan(id: string): Promise<ServicePlan | undefined>;
  createServicePlan(plan: ServicePlan): Promise<void>;
  updateServicePlan(plan: ServicePlan): Promise<boolean>;
  listTaskProfiles(): Promise<TaskProfile[]>;
  getTaskProfile(id: string): Promise<TaskProfile | undefined>;
  createTaskProfile(profile: TaskProfile): Promise<void>;
  updateTaskProfile(profile: TaskProfile): Promise<boolean>;
}
