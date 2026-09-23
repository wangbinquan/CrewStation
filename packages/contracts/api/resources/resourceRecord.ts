import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema } from '../../ids';
import { ClusterPurposeSchema } from '../cluster/resources';
import { StartupProgressSchema } from '../progress/startupProgress';

/**
 * RFC-025 资源中心的标准记录：一个平台资源一条，界面、命令行、MCP 与集群管理都只读它。
 * 期望（spec）只由所属模块写、不出现在这里；实况只由资源中心写（阶段、原因、条件、子对象、启动进度）。
 */
export const ResourceKindSchema = z.enum([
  'namespace', 'network-policy-set', 'dev-workspace', 'agent-execution', 'business-workspace', 'volume',
  'service-slot', 'build-job', 'migration-job', 'route', 'rate-limit-policy', 'database', 'data-binding',
]);

/** 八个标准阶段（RFC-025 提案 §5.2）。 */
export const ResourcePhaseSchema = z.enum(['pending', 'provisioning', 'starting', 'ready', 'degraded', 'stopping', 'stopped', 'failed']);

/** 「在运行」：从受理到降级；结束中与终态都不算，页面不得把它们当成还在运行。 */
export const LIVE_RESOURCE_PHASES = ['pending', 'provisioning', 'starting', 'ready', 'degraded'] as const;
/** 占额度的阶段：在运行的，加上还在回收子对象的结束中（RFC-025 设计 §3）。 */
export const QUOTA_RESOURCE_PHASES = [...LIVE_RESOURCE_PHASES, 'stopping'] as const;

export const ResourceConditionStatusSchema = z.enum(['true', 'false', 'unknown']);
export const ResourceConditionSchema = z.object({
  type: z.string().min(1).max(64),
  status: ResourceConditionStatusSchema,
  reason: z.string().max(64).optional(),
  message: z.string().max(2000).optional(),
  since: z.iso.datetime(),
}).strict();

/** 标准原因：原因码＋说明＋出路（统一预检与调和失败都用它）。 */
export const ResourceReasonSchema = z.object({
  code: z.string().min(1).max(64),
  message: z.string().max(2000),
  hint: z.string().max(2000).optional(),
}).strict();

/** 子对象：Kubernetes 对象（Pod、PVC、Secret……）或数据面对象，带各自的观测。 */
export const ResourceChildSchema = z.object({
  kind: z.string().min(1).max(64),
  namespace: z.string().max(253).optional(),
  name: z.string().min(1).max(253),
  uid: z.string().max(64).optional(),
  /** 观测到的状态短语：Pod 的 Running／Pending……，PVC 的 Bound；尚未观测到是 `absent`。 */
  phase: z.string().max(64),
  ready: z.boolean(),
  reason: z.string().max(2000).optional(),
  node: z.string().max(253).optional(),
  restarts: z.number().int().nonnegative().optional(),
  /** Deployment 的期望副本数与就绪副本数（服务槽，旧健康接口据此推导）。 */
  replicas: z.number().int().nonnegative().optional(),
  readyReplicas: z.number().int().nonnegative().optional(),
  observedAt: z.iso.datetime().optional(),
}).strict();

export const ResourceActionIdSchema = z.enum(['release', 'retry', 'restart', 'delete-volume']);
export const ResourceActionSchema = z.object({
  id: ResourceActionIdSchema,
  enabled: z.boolean(),
  disabledReason: z.string().max(500).optional(),
}).strict();

export const ResourceOwnerSchema = z.object({ module: z.string().min(1).max(64), ref: z.string().min(1).max(200) }).strict();

export const ResourceRecordSchema = z.object({
  id: ResourceIdSchema,
  kind: ResourceKindSchema,
  projectId: ProjectIdSchema.optional(),
  owner: ResourceOwnerSchema,
  parentId: ResourceIdSchema.optional(),
  purpose: ClusterPurposeSchema.optional(),
  phase: ResourcePhaseSchema,
  phaseSince: z.iso.datetime(),
  reason: ResourceReasonSchema.optional(),
  conditions: z.array(ResourceConditionSchema).max(32),
  /** 服务槽的 Pod 随副本数（至多 20）与滚动更新增减，换版本时新旧两批同时在，上限按它留足。 */
  children: z.array(ResourceChildSchema).max(64),
  /** RFC-022 的启动进度，归入标准记录。 */
  startup: StartupProgressSchema.optional(),
  /** 种类声明的展示字段（版本号、档位名、分支……），期望里其余内容界面不解读。 */
  display: z.record(z.string(), z.string().max(500)).optional(),
  generation: z.number().int().nonnegative(),
  observedGeneration: z.number().int().nonnegative(),
  idleSince: z.iso.datetime().optional(),
  retainUntil: z.iso.datetime().optional(),
  actions: z.array(ResourceActionSchema),
  aliases: z.array(z.string().max(253)).optional(),
  version: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();

export type ResourceKind = z.infer<typeof ResourceKindSchema>;
export type ResourcePhase = z.infer<typeof ResourcePhaseSchema>;
export type ResourceConditionStatus = z.infer<typeof ResourceConditionStatusSchema>;
export type ResourceCondition = z.infer<typeof ResourceConditionSchema>;
export type ResourceReason = z.infer<typeof ResourceReasonSchema>;
export type ResourceChild = z.infer<typeof ResourceChildSchema>;
export type ResourceActionId = z.infer<typeof ResourceActionIdSchema>;
export type ResourceAction = z.infer<typeof ResourceActionSchema>;
export type ResourceOwner = z.infer<typeof ResourceOwnerSchema>;
export type ResourceRecord = z.infer<typeof ResourceRecordSchema>;

export function isLiveResourcePhase(phase: ResourcePhase): boolean {
  return (LIVE_RESOURCE_PHASES as readonly ResourcePhase[]).includes(phase);
}

export function occupiesQuotaPhase(phase: ResourcePhase): boolean {
  return (QUOTA_RESOURCE_PHASES as readonly ResourcePhase[]).includes(phase);
}

/** 一条记录上的某个条件；没有就是 undefined（与「为假」区分）。 */
export function resourceCondition(record: Pick<ResourceRecord, 'conditions'>, type: string): ResourceCondition | undefined {
  return record.conditions.find((condition) => condition.type === type);
}
