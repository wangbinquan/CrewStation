import { z } from 'zod';

const id = z.string().min(1).max(256);
export const NativeActivityKindSchema = z.enum([
  'source-ready', 'source-unavailable', 'turn-started', 'request-opened', 'request-resolved',
  'turn-completed', 'turn-cancelled', 'turn-failed', 'turn-unconfirmed', 'process-ended',
]);

/** 原生状态专用通道。不能携带提示词、回答、工具参数，不能从 PTY 字节推断。 */
export const NativeActivitySignalSchema = z.object({
  source: z.enum(['opencode/1.18.29', 'claude-code/2.1.268']),
  sourceEventId: id,
  kind: NativeActivityKindSchema,
  occurredAt: z.iso.datetime(),
  nativeSessionId: id.nullable(),
  turnId: id.nullable(),
  request: z.object({ id, kind: z.enum(['question', 'permission']), resolution: z.enum(['answered', 'rejected', 'withdrawn']).optional() }).strict().optional(),
  reason: z.enum(['channel-gap', 'unsupported-version', 'unmatched-event', 'capacity', 'source-error', 'no-outcome']).optional(),
}).strict().superRefine((signal, ctx) => {
  if ((signal.kind.startsWith('turn-') || signal.kind.startsWith('request-')) && (!signal.turnId || !signal.nativeSessionId)) ctx.addIssue({ code: 'custom', message: '轮次事件必须关联原生会话与轮次' });
  if (signal.kind.startsWith('request-') !== Boolean(signal.request)) ctx.addIssue({ code: 'custom', message: '仅待处理事件携带 request' });
  if (signal.kind === 'request-resolved' && !signal.request?.resolution) ctx.addIssue({ code: 'custom', message: '解决事件必须说明处理结果' });
  if (signal.kind === 'request-opened' && signal.request?.resolution) ctx.addIssue({ code: 'custom', message: '新请求不能已经解决' });
});

export const NativeActivityEventSchema = z.object({
  agentId: id, terminalId: id, runnerId: z.uuid(), eventId: id,
  /** 单 CLI 生命周期内单调递增；Runner 重启由 runnerId 隔开。 */
  seq: z.number().int().positive(), turnOrdinal: z.number().int().nonnegative(),
  signal: NativeActivitySignalSchema,
}).strict();

export type NativeActivityKind = z.infer<typeof NativeActivityKindSchema>;
export type NativeActivitySignal = z.infer<typeof NativeActivitySignalSchema>;
export type NativeActivityEvent = z.infer<typeof NativeActivityEventSchema>;
