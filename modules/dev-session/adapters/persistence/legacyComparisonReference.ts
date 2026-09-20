import { ComparisonTargetSchema, ResourceIdSchema, TaskIdSchema } from '@crewstation/contracts';
import type { ResourceIdentityDirectory } from '@crewstation/persistence';
import { z } from 'zod';
import type { ComparisonReference } from '../../domain/comparisonReference';

const legacy = z.object({ taskId: z.string().max(256), runnerId: z.uuid(), target: ComparisonTargetSchema, deployment: z.string().max(256) }).strict();
/** Explicit adapter for previously issued opaque references, after the caller's project check. */
export async function legacyComparisonReference(value: string, identities?: ResourceIdentityDirectory): Promise<Omit<ComparisonReference, 'id'> | undefined> {
  if (!identities || value.length > 2048) return undefined;
  let source: z.infer<typeof legacy>;
  try { source = legacy.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))); }
  catch { return undefined; }
    const taskId = TaskIdSchema.safeParse(source.taskId).success ? source.taskId : await identities.resolve('task', [source.taskId]);
    if (!taskId) return undefined;
    const runnerComparisonId = ResourceIdSchema.safeParse(source.runnerId).success ? source.runnerId
      : await identities.bind('session', 'workspace-comparison', [taskId, source.runnerId]);
    let deployment = source.deployment;
    const separator = deployment.indexOf(':');
    if (separator !== -1) {
      const before = deployment.slice(0, separator);
      const releaseId = ResourceIdSchema.safeParse(before).success ? before : await identities.resolve('release', [before]);
      if (!releaseId) return undefined;
      deployment = `${releaseId}${deployment.slice(separator)}`;
    }
    return { taskId: TaskIdSchema.parse(taskId), runnerComparisonId, target: source.target, deployment };
}
