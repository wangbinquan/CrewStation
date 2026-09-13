import { z } from 'zod';
import { ProjectIdSchema, TaskIdSchema } from '../../ids';
import { NativeActivitySignalSchema } from '../../taskrunner/nativeActivity';

const id = z.string().min(1).max(256);
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const AgentTurnSummarySchema = z.object({
  turnId: id, ordinal: z.number().int().positive(),
  status: z.enum(['running', 'waiting', 'completed', 'cancelled', 'failed', 'unconfirmed']),
  startedAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();
export const AgentPendingRequestSchema = z.object({
  id, eventId: id, turnId: id, kind: z.enum(['question', 'permission']), openedAt: z.iso.datetime(), seq: sequence, unread: z.boolean().optional(),
}).strict();
export const AgentActivityStateSchema = z.object({
  agentId: id, terminalId: id, runnerId: z.uuid(), throughSeq: sequence,
  source: z.enum(['unknown', 'ready', 'unavailable']), sourceReason: NativeActivitySignalSchema.shape.reason.optional(),
  currentTurn: AgentTurnSummarySchema.nullable(), pending: z.array(AgentPendingRequestSchema).max(128),
  processEnded: z.boolean(), updatedAt: z.iso.datetime(),
}).strict();
export const AgentActivityItemSchema = z.object({
  eventId: id, agentId: id, terminalId: id, runnerId: z.uuid(),
  /** task 的持久事件序号；与 Runner 单 CLI 的内部源 seq 不同。 */
  seq: sequence, turnId: id.nullable(), kind: NativeActivitySignalSchema.shape.kind,
  occurredAt: z.iso.datetime(), request: NativeActivitySignalSchema.shape.request.unwrap().extend({ resolvedByEventId: id.optional() }).optional(), unread: z.boolean(),
}).strict();
export const AgentActivityQuerySchema = z.object({
  /** 缺省取最近一页；指定后按持久序号升序补齐，不跳过中间页。 */
  cursor: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export const ReadAgentActivityRequestSchema = z.object({ agentId: id, turnId: id, throughSeq: sequence }).strict();
export const AgentActivityPageSchema = z.object({
  taskId: TaskIdSchema, projectId: ProjectIdSchema,
  items: z.array(AgentActivityItemSchema).max(100), states: z.array(AgentActivityStateSchema).max(256),
  unread: z.array(z.object({ agentId: id, completions: sequence, issues: sequence }).strict()).max(256),
  nextCursor: sequence, hasMore: z.boolean(), throughSeq: sequence, historyTruncated: z.boolean(),
  sync: z.enum(['ready', 'catching-up', 'unavailable']), connection: z.enum(['connected', 'disconnected', 'unknown']),
  checkedAt: z.iso.datetime(),
}).strict();

export type AgentTurnSummary = z.infer<typeof AgentTurnSummarySchema>;
export type AgentPendingRequest = z.infer<typeof AgentPendingRequestSchema>;
export type AgentActivityState = z.infer<typeof AgentActivityStateSchema>;
export type AgentActivityItem = z.infer<typeof AgentActivityItemSchema>;
export type AgentActivityQuery = z.infer<typeof AgentActivityQuerySchema>;
export type ReadAgentActivityRequest = z.infer<typeof ReadAgentActivityRequestSchema>;
export type AgentActivityPage = z.infer<typeof AgentActivityPageSchema>;
