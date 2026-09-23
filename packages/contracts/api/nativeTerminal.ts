import { ComputeProfileSelectorSchema } from './compute/computeProfile';
import { z } from 'zod';
import { TaskIdSchema, UserIdSchema } from '../ids';
import { NativeTerminalRecordSchema, TerminalSizeSchema, TerminalSnapshotSchema } from '../taskrunner/nativeTerminal';
import { AgentActivityStateSchema } from './activity/nativeActivity';
import { StartupProgressSchema } from './progress/startupProgress';

export const StartNativeTerminalRequestSchema = TerminalSizeSchema.extend({
  // 没有权限字段：开发会话的 CLI 一律完全权限（D59）。
  clientRequestId: z.uuid(), compute: ComputeProfileSelectorSchema.optional(),
  cwd: z.string().min(1).max(1024).optional(),
}).strict();

export const NativeTerminalDtoSchema = NativeTerminalRecordSchema.extend({
  taskId: TaskIdSchema, createdBy: UserIdSchema, clientRequestId: z.uuid(),
  lifecycle: z.enum(['starting', 'running', 'ended', 'failed', 'unknown']),
  connection: z.enum(['connected', 'disconnected', 'unknown']),
  activity: AgentActivityStateSchema.optional(),
  execution: z.object({ taskId: TaskIdSchema, state: z.enum(['queued', 'starting', 'running', 'cleaning', 'finished']), message: z.string().optional(),
    profile: z.object({ name: z.string(), cpu: z.string(), memory: z.string(), storage: z.string() }).optional() }).optional(),
  finalScreen: z.enum(['pending', 'available', 'unavailable']).optional(),
  /** RFC-022：六段启动进度；升级前受理的 CLI 没有。 */
  startup: StartupProgressSchema.optional(),
});
export const NativeTerminalSnapshotDtoSchema = z.object({ status: z.enum(['pending', 'available', 'unavailable']), snapshot: TerminalSnapshotSchema.optional() });
export const NativeTerminalListSchema = z.object({
  items: z.array(NativeTerminalDtoSchema), connection: z.enum(['connected', 'disconnected', 'unknown']),
  runnerId: z.uuid().nullable(), checkedAt: z.iso.datetime(), message: z.string().optional(),
  activitySync: z.enum(['ready', 'catching-up', 'unavailable']).optional(),
});

export type StartNativeTerminalRequest = z.infer<typeof StartNativeTerminalRequestSchema>;
export type NativeTerminalDto = z.infer<typeof NativeTerminalDtoSchema>;
export type NativeTerminalList = z.infer<typeof NativeTerminalListSchema>;
export type NativeTerminalSnapshotDto = z.infer<typeof NativeTerminalSnapshotDtoSchema>;
