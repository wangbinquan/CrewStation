import { z } from 'zod';
import { DeliveryStateSchema } from '../../events/delivery';
import { EventIdSchema, ResourceIdSchema, SubtaskIdSchema, TaskIdSchema, TraceIdSchema, UserIdSchema } from '../../ids';
import { AgentEventTypeSchema } from '../../taskrunner/agentEvents';
import { BusinessTaskStateSchema, SubtaskModeSchema, SubtaskStateSchema } from '../businessTask';
import { pageOf } from '../envelope';

/**
 * 调用链（Design §14；2026-09-23 作者裁定，RFC-020 §4.5 修订）：一条 traceId 在本项目里的全部记录。
 * 三类来源都列：推送给本应用的事件、业务任务、开发会话；同一条链跨类时合成一条，第一个来源是起点。
 * 一个事件投给多个订阅项目时共用 traceId，每个项目只看得到自己那一部分。
 */
export const TraceSourceSchema = z.enum(['event', 'business-task', 'dev-session']);
/** 三档：进行中／已结束／失败。业务任务关闭、开发会话正常释放、事件已送达都算已结束；死信、业务任务失败、子任务最终失败、会话容器失败算失败。 */
export const TraceStatusSchema = z.enum(['running', 'ended', 'failed']);
/** 时间范围按「有活动」算：这段时间里有过活动、或仍在进行的链都算。 */
export const TraceWindowSchema = z.enum(['1h', '24h', '7d', 'all']);

/** 列表游标：上一页最后一条的「开始时间~traceId」，服务端原样解读。 */
export const TRACE_CURSOR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z~[0-9a-f]{32}$/;

export const TraceListQuerySchema = z.object({
  source: TraceSourceSchema.optional(),
  status: TraceStatusSchema.optional(),
  window: TraceWindowSchema.default('all'),
  cursor: z.string().regex(TRACE_CURSOR_PATTERN, '游标格式不对').optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** 列表的一行：按开始时间倒序。 */
export const TraceSummaryDtoSchema = z.object({
  traceId: TraceIdSchema,
  status: TraceStatusSchema,
  startedAt: z.iso.datetime(),
  lastActivityAt: z.iso.datetime(),
  /** 链上出现的来源，按「事件 → 业务任务 → 开发会话」排列。 */
  sources: z.array(TraceSourceSchema).min(1),
  event: z.object({ eventType: z.string(), state: DeliveryStateSchema, attempts: z.number().int().min(0) }).optional(),
  devSession: z.object({ createdBy: UserIdSchema.optional(), branch: z.string().optional(), clis: z.number().int().min(0), agents: z.number().int().min(0) }).optional(),
  business: z.object({ tasks: z.number().int().min(0), subtasks: z.number().int().min(0), failedSubtasks: z.number().int().min(0) }).optional(),
});
export const TraceSummaryPageSchema = pageOf(TraceSummaryDtoSchema);

export const TraceTaskStateSchema = z.enum(['creating', 'running', 'paused', 'releasing', 'released', 'failed']);

/** 一个 Agent 的独立执行（每个 Agent 一个 Pod，RFC-006）：开发会话里的 CLI 与 headless Agent、业务任务的 Agent 子任务。 */
export const TraceExecutionDtoSchema = z.object({
  taskId: TaskIdSchema,
  purpose: z.enum(['cli', 'agent', 'subtask']),
  agentId: z.string(),
  profileName: z.string().optional(),
  protocol: z.string().optional(),
  status: TraceStatusSchema,
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  failureReason: z.string().optional(),
  subtaskId: SubtaskIdSchema.optional(),
  /** 驱动的原生会话 ID（Design §14.1 的 sessionId）。 */
  sessionIds: z.array(z.string()),
  /** 可分页查看的事件条数：Agent 事件、启动前步骤、CLI 活动与终端关闭；平台自己执行的命令不算。 */
  events: z.number().int().min(0),
});

export const TraceSubtaskDtoSchema = z.object({
  subtaskId: SubtaskIdSchema,
  name: z.string(),
  kind: z.enum(['agent', 'command']),
  mode: SubtaskModeSchema.optional(),
  state: SubtaskStateSchema,
  attempt: z.number().int().min(1),
  /** 重试时指向上一次尝试。 */
  retryOf: SubtaskIdSchema.optional(),
  agentProfileName: z.string().optional(),
  sessionId: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  executionTaskId: TaskIdSchema.optional(),
});

/** 链上的一个任务：开发会话或业务任务，其下挂各个 Agent 执行与业务子任务。 */
export const TraceTaskDtoSchema = z.object({
  taskId: TaskIdSchema,
  kind: z.enum(['dev-session', 'business']),
  state: TraceTaskStateSchema,
  status: TraceStatusSchema,
  createdAt: z.iso.datetime(),
  lastActivityAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  createdBy: UserIdSchema.optional(),
  branch: z.string().optional(),
  message: z.string().optional(),
  business: z.object({ state: BusinessTaskStateSchema, callerIdentity: z.string(), closedAt: z.iso.datetime().optional() }).optional(),
  executions: z.array(TraceExecutionDtoSchema),
  subtasks: z.array(TraceSubtaskDtoSchema),
});

/** 一条链的分层回放：起点事件 → 任务 → Agent 执行；事件逐条内容另按执行分页读取。 */
export const TraceChainDtoSchema = z.object({
  traceId: TraceIdSchema,
  status: TraceStatusSchema,
  startedAt: z.iso.datetime(),
  lastActivityAt: z.iso.datetime(),
  sources: z.array(TraceSourceSchema).min(1),
  event: z.object({
    deliveryId: ResourceIdSchema, eventId: EventIdSchema, eventType: z.string(), state: DeliveryStateSchema, attempts: z.number().int().min(0),
    createdAt: z.iso.datetime(), deliveredAt: z.iso.datetime().optional(), nextAttemptAt: z.iso.datetime().optional(), lastError: z.string().optional(),
  }).optional(),
  tasks: z.array(TraceTaskDtoSchema),
});

export const TraceEventsQuerySchema = z.object({
  /** 上一页最后一条的序号。 */
  cursor: z.string().regex(/^\d{1,10}$/, '游标格式不对').optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** 一个执行的一条事件：Agent 事件、启动前步骤、CLI 活动信号或终端关闭。 */
export const TraceEventDtoSchema = z.object({
  seq: z.number().int().min(0),
  at: z.iso.datetime(),
  kind: z.enum(['agent', 'before-start', 'activity', 'terminal-closed']),
  type: AgentEventTypeSchema.optional(),
  /** Agent 的文字输出或思考（截到 2000 字）、启动前步骤名。 */
  text: z.string().optional(),
  tool: z.object({ name: z.string(), isError: z.boolean().optional() }).optional(),
  /** 启动前的状态、CLI 活动信号的种类、Agent 的状态文字。 */
  status: z.string().optional(),
  error: z.string().optional(),
  sessionId: z.string().optional(),
  exitCode: z.number().int().nullable().optional(),
});
export const TraceEventPageSchema = pageOf(TraceEventDtoSchema);

export type TraceSource = z.infer<typeof TraceSourceSchema>;
export type TraceStatus = z.infer<typeof TraceStatusSchema>;
export type TraceWindow = z.infer<typeof TraceWindowSchema>;
export type TraceListQuery = z.infer<typeof TraceListQuerySchema>;
export type TraceListQueryInput = z.input<typeof TraceListQuerySchema>;
export type TraceSummaryDto = z.infer<typeof TraceSummaryDtoSchema>;
export type TraceTaskState = z.infer<typeof TraceTaskStateSchema>;
export type TraceExecutionDto = z.infer<typeof TraceExecutionDtoSchema>;
export type TraceSubtaskDto = z.infer<typeof TraceSubtaskDtoSchema>;
export type TraceTaskDto = z.infer<typeof TraceTaskDtoSchema>;
export type TraceChainDto = z.infer<typeof TraceChainDtoSchema>;
export type TraceEventsQuery = z.infer<typeof TraceEventsQuerySchema>;
export type TraceEventDto = z.infer<typeof TraceEventDtoSchema>;
