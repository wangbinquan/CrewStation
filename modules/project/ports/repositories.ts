import type { MemberRole, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import type { ComputeProfile, ServicePlan, TaskProfile } from '../domain/plans';
import type { Project } from '../domain/project';
import type { TaskQuota } from '../domain/quota';
import type { Service } from '../domain/service';

export interface ProjectRepository {
  insert(project: Project): Promise<void>;
  update(project: Project): Promise<void>;
  getById(id: ProjectId): Promise<Project | undefined>;
  getBySlug(slug: string): Promise<Project | undefined>;
  list(): Promise<Project[]>;
  listByIds(ids: readonly ProjectId[]): Promise<Project[]>;
}

export interface ServiceRepository {
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
}

export interface QuotaRepository {
  get(projectId: ProjectId): Promise<TaskQuota | undefined>;
  upsert(quota: TaskQuota): Promise<void>;
}

export interface CatalogRepository {
  listServicePlans(): Promise<ServicePlan[]>;
  getServicePlan(name: string): Promise<ServicePlan | undefined>;
  upsertServicePlan(plan: ServicePlan): Promise<void>;
  listTaskProfiles(): Promise<TaskProfile[]>;
  getTaskProfile(name: string): Promise<TaskProfile | undefined>;
  upsertTaskProfile(profile: TaskProfile): Promise<void>;
  listComputeProfiles(): Promise<ComputeProfile[]>;
  getComputeProfile(name: string): Promise<ComputeProfile | undefined>;
  upsertComputeProfile(profile: ComputeProfile): Promise<void>;
  deleteComputeProfile(name: string): Promise<void>;
}

export type { ComputeProfile };
