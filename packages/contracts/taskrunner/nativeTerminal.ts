import { z } from 'zod';
import { AgentPermissionSchema } from '../manifest/tasks';
import { BeforeStartStateSchema } from './beforeStart';
import { AgentProtocolSchema } from './launch';

export const TerminalSizeSchema = z.object({ cols: z.number().int().min(10).max(300), rows: z.number().int().min(2).max(120) });
export const NativeTerminalRecordSchema = TerminalSizeSchema.extend({
  agentId: z.string().min(1), terminalId: z.string().min(1), runnerId: z.uuid(),
  compute: z.string().min(1), computeName: z.string().optional(), permission: AgentPermissionSchema,
  revision: z.number().int().nonnegative(),
  lifecycle: z.enum(['starting', 'running', 'ended', 'failed']),
  startedAt: z.iso.datetime(), endedAt: z.iso.datetime().optional(),
  nativeSessionId: z.string().optional(), exitCode: z.number().int().nullable().optional(),
  reason: z.enum(['exited', 'stopped', 'start-failed', 'before-start-failed', 'runner-restarted', 'environment-failed']).optional(),
  error: z.string().optional(),
  /** RFC-006：此 CLI 固定使用的档位修订与协议；terminal 协议没有 Agent 动态。旧 Runner 的名册没有这两项。 */
  profileRevision: z.number().int().min(1).optional(),
  protocol: AgentProtocolSchema.optional(),
  /** 启动前 Hook 的进度；只含执行 ID、状态与当前步骤名，不含脚本或文件内容。 */
  beforeStart: z.object({ executionId: z.string().min(1), state: BeforeStartStateSchema, currentStep: z.string().optional(), failedStep: z.string().optional() }).optional(),
  /**
   * RFC-024：CLI 界面是否已画出，由 Runner 在自己的无头终端上判定。新 Runner 在进程拉起时写 waiting；
   * 旧 Runner 没有这一项，平台据此按「进程拉起即就绪」处理。`by` 在 ready 时必有：画出界面（screen）或超时放行（timeout）。
   */
  ui: z.object({ state: z.enum(['waiting', 'ready']), readyAt: z.iso.datetime().optional(), by: z.enum(['screen', 'timeout']).optional() }).optional(),
});
export const NativeTerminalRosterSchema = z.object({ runnerId: z.uuid(), terminals: z.array(NativeTerminalRecordSchema) });
/** 输入控制的持有人：cs-session 按浏览器连接的网关身份注入，浏览器自己带来的一律覆盖。 */
export const TerminalHolderSchema = z.object({ userId: z.string().min(1), name: z.string().max(200) });
/**
 * 一个 CLI 窗口此刻的输入控制（2026-09-23）：有没有人持有、是谁；`revision` 每次换人或释放加一，
 * 查看者按它丢弃迟到的旧状态。旧 Runner 没有这一项，查看者据此退回「看不到是谁」。
 */
export const TerminalControlStateSchema = z.object({ held: z.boolean(), holder: TerminalHolderSchema.optional(), revision: z.number().int().nonnegative() });
export const TerminalSnapshotSchema = TerminalSizeSchema.extend({
  terminalId: z.string(), runnerId: z.uuid(), throughSeq: z.number().int().nonnegative(),
  data: z.string(), scrollbackLimit: z.number().int().nonnegative(), truncated: z.boolean(),
  control: TerminalControlStateSchema.optional(),
});
export const TerminalControlSchema = z.object({
  controlled: z.boolean(), expiresAt: z.iso.datetime().nullable(),
  control: TerminalControlStateSchema.optional(),
});

export type NativeTerminalRecord = z.infer<typeof NativeTerminalRecordSchema>;
export type NativeTerminalRoster = z.infer<typeof NativeTerminalRosterSchema>;
export type TerminalSnapshot = z.infer<typeof TerminalSnapshotSchema>;
export type TerminalHolder = z.infer<typeof TerminalHolderSchema>;
export type TerminalControlState = z.infer<typeof TerminalControlStateSchema>;
export type TerminalControl = z.infer<typeof TerminalControlSchema>;
