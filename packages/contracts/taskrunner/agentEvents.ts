import { z } from 'zod';
import { AgentDriverSchema, AgentPermissionSchema } from '../manifest/tasks';

/** 驱动层把两个 CLI 的输出归一为这一种事件；工作台流式面板与 execution_events 都消费它。 */
export const AgentEventTypeSchema = z.enum([
  'started', 'session', 'text', 'thinking', 'tool-start', 'tool-end', 'permission', 'status', 'error', 'completed', 'cancelled',
]);

export const AgentEventSchema = z.object({
  agentId: z.string().min(1),
  seq: z.number().int().min(0),
  at: z.iso.datetime(),
  type: AgentEventTypeSchema,
  /** CLI 原生会话 ID，出现后可用于 resume。 */
  sessionId: z.string().optional(),
  /**
   * `started` 事件带上这次运行的规格。工作台的 Agent 列表是按持久事件还原的，
   * 没有它就只能编造驱动名、模型与权限——权限编错尤其误导人。
   */
  spec: z.object({ compute: z.string(), driver: AgentDriverSchema, model: z.string(), permission: AgentPermissionSchema }).optional(),
  text: z.string().optional(),
  tool: z.object({ callId: z.string().optional(), name: z.string(), input: z.unknown().optional(), output: z.unknown().optional(), isError: z.boolean().optional() }).optional(),
  status: z.string().optional(),
  error: z.object({ code: z.string().optional(), message: z.string() }).optional(),
  result: z.object({
    summary: z.string().optional(),
    exitCode: z.number().int().optional(),
    usage: z.record(z.string(), z.unknown()).optional(),
    durationMs: z.number().int().min(0).optional(),
  }).optional(),
  /** 驱动原始事件，仅用于排障与追溯，不作为契约。 */
  raw: z.unknown().optional(),
});

export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type AgentEventType = z.infer<typeof AgentEventTypeSchema>;
