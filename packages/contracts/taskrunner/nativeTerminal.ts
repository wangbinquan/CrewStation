import { z } from 'zod';
import { AgentPermissionSchema } from '../manifest/tasks';

export const TerminalSizeSchema = z.object({ cols: z.number().int().min(10).max(300), rows: z.number().int().min(2).max(120) });
export const NativeTerminalRecordSchema = TerminalSizeSchema.extend({
  agentId: z.string().min(1), terminalId: z.string().min(1), runnerId: z.uuid(),
  compute: z.string().min(1), permission: AgentPermissionSchema,
  revision: z.number().int().nonnegative(),
  lifecycle: z.enum(['starting', 'running', 'ended', 'failed']),
  startedAt: z.iso.datetime(), endedAt: z.iso.datetime().optional(),
  nativeSessionId: z.string().optional(), exitCode: z.number().int().nullable().optional(),
  reason: z.enum(['exited', 'stopped', 'start-failed', 'runner-restarted']).optional(),
  error: z.string().optional(),
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
