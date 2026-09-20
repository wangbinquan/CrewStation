import { z } from 'zod';
import { ProjectIdSchema, ServiceIdSchema, SlugSchema, UserIdSchema } from '../ids';
import { ManifestKindSchema } from '../manifest/serviceSpec';
import { MemberRoleSchema, PlatformRoleSchema } from './identity';
import { ProjectTemplateDtoSchema } from './scm';

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

/**
 * 项目列表的查询参数（RFC-002）。`kind` 是逗号分隔的清单：租户空间只要 `DigitalWorker`，
 * 管理空间的接入容器页要 `APIProxy,EventProducer`。
 * 省略时行为不变——返回作用域内全部，现有调用方不破。
 * 过滤发生在作用域判定之后，`kind` 不是放大可见范围的口子。
 */
export const ListProjectsQuerySchema = z.object({
  kind: z
    .preprocess(
      (value) => (typeof value === 'string' ? value.split(',').map((item) => item.trim()).filter((item) => item !== '') : value),
      z.array(ManifestKindSchema).min(1),
    )
    .optional(),
});

/** 开发者自建默认本人；管理员可代建并指定资源。 */
export const CreateProjectRequestSchema = z.object({
  slug: SlugSchema,
  name: z.string().min(1).max(80),
  kind: ManifestKindSchema.default('DigitalWorker'),
  ownerUserId: UserIdSchema.optional(),
  template: SlugSchema.default('minimal-sample'),
  plan: SlugSchema.optional(),
  maxConcurrentTasks: z.number().int().min(1).max(100).optional(),
}).strict();

export const ProjectCreationCatalogSchema = z.object({ templates: z.array(ProjectTemplateDtoSchema), defaultServicePlan: SlugSchema, maxConcurrentTasks: z.number().int().min(1) });
export type ProjectCreationCatalog = z.infer<typeof ProjectCreationCatalogSchema>;

export const MemberDtoSchema = z.object({ userId: UserIdSchema, role: MemberRoleSchema, platformRole: PlatformRoleSchema.optional(), name: z.string(), email: z.string() });
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
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;
export type ProjectState = z.infer<typeof ProjectStateSchema>;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export type MemberDto = z.infer<typeof MemberDtoSchema>;
export type SetMemberRequest = z.infer<typeof SetMemberRequestSchema>;
export type SetQuotaRequest = z.infer<typeof SetQuotaRequestSchema>;
export type QuotaDto = z.infer<typeof QuotaDtoSchema>;
export type ServicePlanDto = z.infer<typeof ServicePlanDtoSchema>;
export type TaskProfileDto = z.infer<typeof TaskProfileDtoSchema>;
export type ServiceDto = z.infer<typeof ServiceDtoSchema>;
