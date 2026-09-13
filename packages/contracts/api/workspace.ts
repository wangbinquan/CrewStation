import { z } from 'zod';
import { TaskIdSchema } from '../ids';
import { WorkspaceReadySchema, WorkspaceUnavailableSchema } from '../taskrunner/workspace';

/** 只读预检；无会话为 404，断线／Git 失败必须保留 unavailable。 */
export const WorkspaceStatusDtoSchema = z.discriminatedUnion('status', [
  WorkspaceReadySchema.extend({ taskId: TaskIdSchema }),
  WorkspaceUnavailableSchema.extend({ taskId: TaskIdSchema }),
]);
export type WorkspaceStatusDto = z.infer<typeof WorkspaceStatusDtoSchema>;
