import { z } from 'zod';
import { SlugSchema, TaskIdSchema, UserIdSchema } from '../ids';
import { AgentPermissionSchema } from '../manifest/tasks';
import { NativeTerminalRecordSchema, TerminalSizeSchema, TerminalSnapshotSchema } from '../taskrunner/nativeTerminal';
import { AgentActivityStateSchema } from './activity/nativeActivity';

export const StartNativeTerminalRequestSchema = TerminalSizeSchema.extend({
  clientRequestId: z.uuid(), compute: SlugSchema.optional(), permission: AgentPermissionSchema.default('edit'),
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
