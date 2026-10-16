import { ResourceIdSchema } from '@crewstation/contracts';

/** Links carry identity only. Assessment, authorization and confirmation still
 * use the existing recovery API; no action or digest is accepted from a URL. */
export function parseBusinessRecoverySearch(search: Record<string, unknown>): { taskId?: string; projectId?: string; subtaskId?: string } {
  const id = (value: unknown) => { const parsed = ResourceIdSchema.safeParse(value); return parsed.success ? parsed.data : undefined; };
  const taskId = id(search.taskId), projectId = id(search.projectId), subtaskId = id(search.subtaskId);
  return { ...(taskId ? { taskId } : {}), ...(projectId ? { projectId } : {}), ...(taskId && subtaskId ? { subtaskId } : {}) };
}
