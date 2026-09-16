import { z } from 'zod';
import { AgentPermissionSchema } from '../manifest/tasks';
import { BeforeStartStateSchema, RuntimeRevisionRefSchema } from './beforeStart';

export const TerminalSizeSchema = z.object({ cols: z.number().int().min(10).max(300), rows: z.number().int().min(2).max(120) });
export const NativeTerminalRecordSchema = TerminalSizeSchema.extend({
  agentId: z.string().min(1), terminalId: z.string().min(1), runnerId: z.uuid(),
  compute: z.string().min(1), permission: AgentPermissionSchema,
  revision: z.number().int().nonnegative(),
  lifecycle: z.enum(['starting', 'running', 'ended', 'failed']),
  startedAt: z.iso.datetime(), endedAt: z.iso.datetime().optional(),
  nativeSessionId: z.string().optional(), exitCode: z.number().int().nullable().optional(),
  reason: z.enum(['exited', 'stopped', 'start-failed', 'before-start-failed', 'runner-restarted', 'environment-failed']).optional(),
  error: z.string().optional(),
  /** RFC-004：此 CLI 固定使用的运行环境版本；没有则为部署配置模式。 */
  runtime: RuntimeRevisionRefSchema.optional(),
  /** 启动前 Hook 的进度；只含执行 ID、状态与当前步骤名，不含脚本或文件内容。 */
  beforeStart: z.object({ executionId: z.string().min(1), state: BeforeStartStateSchema, currentStep: z.string().optional(), failedStep: z.string().optional() }).optional(),
});
export const NativeTerminalRosterSchema = z.object({ runnerId: z.uuid(), terminals: z.array(NativeTerminalRecordSchema) });
export const TerminalSnapshotSchema = TerminalSizeSchema.extend({
  terminalId: z.string(), runnerId: z.uuid(), throughSeq: z.number().int().nonnegative(),
  data: z.string(), scrollbackLimit: z.number().int().nonnegative(), truncated: z.boolean(),
});
export const TerminalControlSchema = z.object({
  controlled: z.boolean(), expiresAt: z.iso.datetime().nullable(),
});

export type NativeTerminalRecord = z.infer<typeof NativeTerminalRecordSchema>;
export type NativeTerminalRoster = z.infer<typeof NativeTerminalRosterSchema>;
export type TerminalSnapshot = z.infer<typeof TerminalSnapshotSchema>;
export type TerminalControl = z.infer<typeof TerminalControlSchema>;
