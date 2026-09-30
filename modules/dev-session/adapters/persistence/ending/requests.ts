import { eq } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import { conflict, jsonHash } from '@crewstation/kernel';
import { DevelopmentEndingJobSchema, DevelopmentEndingRequestSchema } from '../../../domain/developmentEnding';
import type { DevelopmentEndingRequest } from '../../../domain/developmentEnding';
import { agentStarts } from '../agentStartTable';
import { developmentAgentUsage } from '../developmentUsageTable';
import { developmentAgentEndings as table } from './tables';
import { withEndingTransaction } from './transaction';

export function requestDevelopmentEndingJob(db: Database, raw: DevelopmentEndingRequest) {
  const input = DevelopmentEndingRequestSchema.parse(raw);
  return withEndingTransaction(db, input.executionTaskId, async ({ tx, original, start, job }) => {
    if (jsonHash(original.binding) !== jsonHash(input.expectedRegistration)) throw conflict('结束请求期间原数字绑定已改变');
    const result = input.receipt?.result ?? null;
    if (job?.logicalResult && result && job.logicalResult !== result) throw conflict('原执行结果不可替换');
    const changed = job && !job.logicalResult && result;
    const next = DevelopmentEndingJobSchema.parse(job ? { ...job, logicalResult: job.logicalResult ?? result, version: job.version + (changed ? 1 : 0) } : {
      executionTaskId: input.executionTaskId, firstReason: original.closeReason ?? input.reason, observedAt: input.observedAt,
      logicalResult: result, actualEndedAt: null, version: 1, fence: 0, leaseUntil: null, lastAttemptAt: input.observedAt, stop: null, closure: null, stage: 'awaiting-stop',
    });
    await tx.update(developmentAgentUsage).set({ closeReason: next.firstReason }).where(eq(developmentAgentUsage.executionTaskId, input.executionTaskId));
    // Preserve old public finalized/endedAt. Neither is a digital exit or actual-time proof.
    await tx.update(agentStarts).set({ logicalEnding: true, state: 'ended' }).where(eq(agentStarts.agentId, start.agentId));
    await tx.insert(table).values(next).onConflictDoUpdate({ target: table.executionTaskId, set: { logicalResult: next.logicalResult, version: next.version } });
    return next;
  });
}
