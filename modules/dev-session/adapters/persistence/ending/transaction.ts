import { eq } from 'drizzle-orm';
import type { TaskId } from '@crewstation/contracts';
import type { Database, Transaction } from '@crewstation/persistence';
import { notFound, precondition } from '@crewstation/kernel';
import { DevelopmentUsageOwnerRecordSchema } from '../../../domain/developmentUsage';
import { DevelopmentEndingJobSchema } from '../../../domain/developmentEnding';
import type { DevelopmentEndingJob } from '../../../domain/developmentEnding';
import type { DevelopmentUsageOwnerRecord } from '../../../ports/developmentUsage';
import { developmentAgentUsage } from '../developmentUsageTable';
import { agentStarts } from '../agentStartTable';
import { developmentAgentEndings } from './tables';

export interface EndingTransaction {
  tx: Transaction; original: DevelopmentUsageOwnerRecord; start: typeof agentStarts.$inferSelect; job: DevelopmentEndingJob | undefined;
}
export function withEndingTransaction<T>(db: Database, id: TaskId, operation: (input: EndingTransaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const owner = (await tx.select().from(developmentAgentUsage).where(eq(developmentAgentUsage.executionTaskId, id)).for('update'))[0];
    if (!owner) throw notFound('开发数字受理', id);
    const original = DevelopmentUsageOwnerRecordSchema.parse({ ...owner.prepared, binding: owner.binding, unsupported: owner.unsupported, closeReason: owner.closeReason,
      ...(owner.capabilityPodUid ? { capabilityPodUid: owner.capabilityPodUid } : {}) });
    if (original.unsupported) throw precondition('旧 Runner 不能创建数字结束作业');
    const start = (await tx.select().from(agentStarts).where(eq(agentStarts.executionTaskId, id)).for('update'))[0];
    const i = original.intent;
    if (!start || start.agentId !== i.identity.agentId || start.taskId !== i.identity.taskId || start.execution.taskId !== id || start.profile.profileId !== i.profileId || start.profile.revision !== i.profileRevision)
      throw precondition('结束作业必须保持原 Agent 身份与固定档位');
    const row = (await tx.select().from(developmentAgentEndings).where(eq(developmentAgentEndings.executionTaskId, id)).for('update'))[0];
    return operation({ tx, original, start, job: row ? DevelopmentEndingJobSchema.parse(row) : undefined });
  });
}
