import { z } from 'zod';
import { ProjectIdSchema, ReleaseIdSchema, ServiceIdSchema, SubtaskIdSchema, TaskIdSchema, TraceIdSchema } from '../ids';
import { ManifestSchema } from '../manifest/manifest';

/**
 * 跨模块领域事件：发布方模块发布，订阅方只依赖本文件，不依赖发布方模块
 * （docs/engineering/repository-structure.md §4.3）。主题名 `<模块>.<过去分词>`。
 */
export const DomainTopic = {
  projectCreated: 'project.created',
  projectArchived: 'project.archived',
  releaseRegistered: 'release.registered',
  releaseStatusChanged: 'release.status-changed',
  trafficSwitched: 'release.traffic-switched',
  maintenanceChanged: 'gateway.maintenance-changed',
  taskCreated: 'task-runtime.task-created',
  taskReleased: 'task-runtime.task-released',
  subtaskFinished: 'business-task.subtask-finished',
  grantChanged: 'api-catalog.grant-changed',
  configChanged: 'config.changed',
} as const;

export const SlotNameSchema = z.enum(['preview', 'prod']);

const base = { occurredAt: z.iso.datetime(), traceId: TraceIdSchema.optional() };

export const ProjectCreatedSchema = z.object({ ...base, projectId: ProjectIdSchema, slug: z.string(), kind: ManifestSchema.options[0].shape.kind.or(z.enum(['APIProxy', 'EventProducer'])), namespace: z.string() });
export const ProjectArchivedSchema = z.object({ ...base, projectId: ProjectIdSchema });

/** 发布登记：Manifest 的 exposes／subscriptions／produces／tasks 段随之被 api-catalog、events、business-task 各自落表。 */
export const ReleaseRegisteredSchema = z.object({
  ...base,
  projectId: ProjectIdSchema,
  serviceId: ServiceIdSchema,
  releaseId: ReleaseIdSchema,
  tag: z.string(),
  commitSha: z.string(),
  manifest: ManifestSchema,
  /** exposes 指向的 OpenAPI 文档内容（已解析），由 release 模块从标签处读取。 */
  openapiDocument: z.unknown().optional(),
});

/** offline：所在的待命槽已下线（RFC-021），可从发布记录重新部署。 */
export const ReleaseStatusSchema = z.enum(['pending', 'building', 'migrating', 'deploying', 'ready', 'failed', 'superseded', 'offline']);
export const ReleaseStatusChangedSchema = z.object({ ...base, serviceId: ServiceIdSchema, releaseId: ReleaseIdSchema, status: ReleaseStatusSchema, slot: SlotNameSchema.optional(), message: z.string().optional() });

/** 切流后订阅推送目标、路由与告警基线都随 active 槽变化。 */
export const TrafficSwitchedSchema = z.object({ ...base, projectId: ProjectIdSchema, serviceId: ServiceIdSchema, fromSlot: SlotNameSchema, toSlot: SlotNameSchema, releaseId: ReleaseIdSchema, actorUserId: z.string() });

/** 正式版本维护的进入、调整与退出（RFC-021）；events 据此补发暂存的投递。 */
export const MaintenanceChangedSchema = z.object({ ...base, projectId: ProjectIdSchema, serviceId: ServiceIdSchema, active: z.boolean(), holdEvents: z.boolean() });

/** profile-test：管理员档位测试的平台专属短期任务（RFC-006），跑在系统命名空间。 */
export const TaskKindSchema = z.enum(['dev-session', 'business', 'profile-test']);
export const TaskCreatedSchema = z.object({ ...base, projectId: ProjectIdSchema, serviceId: ServiceIdSchema, taskId: TaskIdSchema, kind: TaskKindSchema });
export const TaskReleasedSchema = z.object({ ...base, projectId: ProjectIdSchema, taskId: TaskIdSchema, kind: TaskKindSchema, reason: z.enum(['user', 'owner-force', 'business', 'failed', 'pod-lost', 'profile-test']) });

export const SubtaskFinishedSchema = z.object({ ...base, taskId: TaskIdSchema, subtaskId: SubtaskIdSchema, state: z.enum(['succeeded', 'failed', 'cancelled']), attempt: z.number().int().min(1) });

export const GrantChangedSchema = z.object({ ...base, serviceId: ServiceIdSchema, operationId: z.string(), state: z.enum(['granted', 'revoked']) });
export const ConfigChangedSchema = z.object({ ...base, projectId: ProjectIdSchema, env: z.enum(['production', 'development']), version: z.number().int().min(1) });

export const DomainPayloadSchemas = {
  [DomainTopic.projectCreated]: ProjectCreatedSchema,
  [DomainTopic.projectArchived]: ProjectArchivedSchema,
  [DomainTopic.releaseRegistered]: ReleaseRegisteredSchema,
  [DomainTopic.releaseStatusChanged]: ReleaseStatusChangedSchema,
  [DomainTopic.trafficSwitched]: TrafficSwitchedSchema,
  [DomainTopic.maintenanceChanged]: MaintenanceChangedSchema,
  [DomainTopic.taskCreated]: TaskCreatedSchema,
  [DomainTopic.taskReleased]: TaskReleasedSchema,
  [DomainTopic.subtaskFinished]: SubtaskFinishedSchema,
  [DomainTopic.grantChanged]: GrantChangedSchema,
  [DomainTopic.configChanged]: ConfigChangedSchema,
} as const;

export type DomainTopicName = (typeof DomainTopic)[keyof typeof DomainTopic];
export type DomainPayload<T extends DomainTopicName> = z.infer<(typeof DomainPayloadSchemas)[T]>;
export type SlotName = z.infer<typeof SlotNameSchema>;
export type ReleaseStatus = z.infer<typeof ReleaseStatusSchema>;
export type TaskKind = z.infer<typeof TaskKindSchema>;
