import { z } from 'zod';
import { ProjectIdSchema, RuntimeConfigIdSchema, ServiceIdSchema, SlugSchema, UserIdSchema } from '../ids';
import { AgentDriverSchema } from '../manifest/tasks';
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

/**
 * 算力档位（RFC-001）：管理员定义，Manifest 与开发会话按名引用。
 * `driver` 与 `model` 是平台的采购信息，只在管理面返回；租户面用 ComputeProfileSummaryDto。
 */
export const ComputeProfileDtoSchema = z.object({
  name: SlugSchema,
  driver: AgentDriverSchema,
  /** `<provider>/<model>`。 */
  model: z.string().min(1),
  /** 每个原生 CLI 的资源套餐；省略时使用平台默认任务套餐。 */
  taskProfile: SlugSchema.optional(),
  description: z.string().default(''),
  /** RFC-004：绑定的管理员运行环境；缺省为部署配置模式（CS_AGENT_ENV_SECRET）。 */
  runtimeConfigId: RuntimeConfigIdSchema.optional(),
  /** 每次写入递增；写操作用 expectedRevision 比较，旧客户端不能无意清掉 runtimeConfigId。 */
  revision: z.number().int().min(0).default(0),
});

/** 写请求：revision 由服务端维护，调用方只给期望值；已托管档位的写入必须携带 expectedRevision。 */
export const ComputeProfileWriteRequestSchema = ComputeProfileDtoSchema.omit({ revision: true }).extend({ expectedRevision: z.number().int().min(0).optional() });

/** 管理面：绑定的运行环境就绪信息，来自 agent-runtime 的公开查询。 */
export const ComputeProfileRuntimeStateSchema = z.object({
  configName: SlugSchema,
  driver: AgentDriverSchema,
  enabled: z.boolean(),
  activeRevision: z.number().int().min(1).nullable(),
  ready: z.boolean(),
  reason: z.string().optional(),
});
export const ComputeProfileAdminDtoSchema = ComputeProfileDtoSchema.extend({ runtime: ComputeProfileRuntimeStateSchema.optional() });

/**
 * 租户面投影：够画下拉，不泄露厂商与模型标识符。
 * available 与 reason 只说“能不能起 Agent、为什么不能”；托管模式下由运行环境是否已启用决定。
 */
export const ComputeProfileSummaryDtoSchema = z.object({
  name: SlugSchema,
  description: z.string().default(''),
  mode: z.enum(['legacy', 'managed']),
  available: z.boolean(),
  reason: z.string().optional(),
});

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
export type ComputeProfileDto = z.infer<typeof ComputeProfileDtoSchema>;
export type ComputeProfileSummaryDto = z.infer<typeof ComputeProfileSummaryDtoSchema>;
export type ComputeProfileWriteRequest = z.infer<typeof ComputeProfileWriteRequestSchema>;
export type ComputeProfileAdminDto = z.infer<typeof ComputeProfileAdminDtoSchema>;
export type ComputeProfileRuntimeState = z.infer<typeof ComputeProfileRuntimeStateSchema>;
export type ServiceDto = z.infer<typeof ServiceDtoSchema>;
