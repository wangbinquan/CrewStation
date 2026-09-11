import { z } from 'zod';
import { ProjectIdSchema, ServiceIdSchema, SlugSchema, UserIdSchema } from '../ids';
import { ManifestKindSchema } from '../manifest/serviceSpec';
import { MemberRoleSchema } from './identity';

export const ProjectStateSchema = z.enum(['provisioning', 'active', 'paused', 'archived', 'failed']);

export const ProjectDtoSchema = z.object({
  id: ProjectIdSchema,
  slug: SlugSchema,
  name: z.string().min(1).max(80),
  kind: ManifestKindSchema,
  namespace: z.string(),
  ownerUserId: UserIdSchema,
  state: ProjectStateSchema,
  serviceId: ServiceIdSchema.optional(),
  /** provisioning／failed 等状态的说明，例如开通链失败的步骤与原因。 */
  message: z.string().optional(),
  createdAt: z.iso.datetime(),
});

/** 管理员代建项目并指定负责人（G16）。 */
export const CreateProjectRequestSchema = z.object({
  slug: SlugSchema,
  name: z.string().min(1).max(80),
  kind: ManifestKindSchema.default('DigitalWorker'),
  ownerUserId: UserIdSchema,
  template: SlugSchema.default('minimal-sample'),
  plan: SlugSchema.optional(),
  maxConcurrentTasks: z.number().int().min(1).max(100).optional(),
});

export const MemberDtoSchema = z.object({ userId: UserIdSchema, role: MemberRoleSchema, name: z.string(), email: z.string() });
export const SetMemberRequestSchema = z.object({ userId: UserIdSchema, role: MemberRoleSchema });

export const QuotaDtoSchema = z.object({ maxConcurrentTasks: z.number().int().min(1), running: z.number().int().min(0) });
export const SetQuotaRequestSchema = z.object({ maxConcurrentTasks: z.number().int().min(1).max(100) });

export const ServicePlanDtoSchema = z.object({ name: SlugSchema, cpu: z.string(), memory: z.string(), maxReplicas: z.number().int().min(1), description: z.string().default('') });
export const TaskProfileDtoSchema = z.object({ name: SlugSchema, cpu: z.string(), memory: z.string(), storage: z.string(), description: z.string().default('') });

export const ServiceDtoSchema = z.object({
  id: ServiceIdSchema,
  projectId: ProjectIdSchema,
  name: SlugSchema,
  kind: ManifestKindSchema,
  identity: z.string(),
  prodHost: z.string(),
  previewHost: z.string(),
  serviceHost: z.string(),
});

export type ProjectDto = z.infer<typeof ProjectDtoSchema>;
export type ProjectState = z.infer<typeof ProjectStateSchema>;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export type MemberDto = z.infer<typeof MemberDtoSchema>;
export type SetMemberRequest = z.infer<typeof SetMemberRequestSchema>;
export type SetQuotaRequest = z.infer<typeof SetQuotaRequestSchema>;
export type QuotaDto = z.infer<typeof QuotaDtoSchema>;
export type ServicePlanDto = z.infer<typeof ServicePlanDtoSchema>;
export type TaskProfileDto = z.infer<typeof TaskProfileDtoSchema>;
export type ServiceDto = z.infer<typeof ServiceDtoSchema>;
