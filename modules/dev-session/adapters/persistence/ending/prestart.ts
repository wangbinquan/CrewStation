import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '@crewstation/persistence';
import { TaskIdSchema } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import { DevelopmentCleanupSelectionSchema, DevelopmentPrestartCleanupEvidenceSchema } from '../../../domain/development/prestartCleanup';
import type { DevelopmentPrestartCleanupEvidence } from '../../../domain/development/prestartCleanup';
import { DevelopmentEndingJobSchema } from '../../../domain/developmentEnding';
import { developmentAgentEndings as table } from './tables';
import { withEndingTransaction } from './transaction';

/** External original proof/lookup is obtained by the use case before this owner-only transaction. */
export function completePrestartEnding(db: Database, raw: DevelopmentPrestartCleanupEvidence) {
  const evidence = DevelopmentPrestartCleanupEvidenceSchema.parse(raw), selection = evidence.selection;
  if (evidence.phase !== 'closed') throw precondition('未获准启动终态必须先有实际物理停止证明');
  return withEndingTransaction(db, TaskIdSchema.parse(selection.identity.executionId), async ({ tx, original, start, job }) => {
    const price = original.price;
    const owner = { payloadDigest: original.payloadDigest, firstReason: original.closeReason, acceptedAt: price.acceptedAt,
      profileId: price.profile!.id, profileRevision: price.profile!.revision, protocol: price.profile!.protocol, priceBookRevision: price.priceBookRevision };
    if (original.binding || original.unsupported || !original.closeReason || !start.logicalEnding || start.state !== 'ended' || !job
      || jsonHash(original.intent.identity) !== jsonHash(selection.identity) || original.intent.profileId !== selection.profileId
      || original.intent.profileRevision !== selection.profileRevision || job.firstReason !== original.closeReason
      || jsonHash(owner) !== jsonHash(evidence.owner)) throw precondition('原未绑定 owner、AgentStart 与结束作业尚未闭合');
    if (job.stage === 'prestart-closed') {
      if (jsonHash(job.prestartClosure) !== jsonHash(evidence)) throw conflict('原未获准启动闭合不可替换');
      return job;
    }
    if (job.stop || job.closure || job.logicalResult) throw conflict('原数字结束不能转换为未获准启动闭合');
    const next = DevelopmentEndingJobSchema.parse({ ...job, stage: 'prestart-closed', prestartClosure: evidence,
      leaseUntil: null, version: job.version + 1, fence: job.fence + 1 });
    await tx.update(table).set(next).where(eq(table.executionTaskId, next.executionTaskId)); return next;
  });
}

/** Re-read the actual owner/AgentStart/job together; public AgentStart projections omit logicalEnding. */
export function inspectPrestartEnding(db: Database, raw: z.infer<typeof DevelopmentCleanupSelectionSchema>) {
  const selection = DevelopmentCleanupSelectionSchema.parse(raw);
  return withEndingTransaction(db, TaskIdSchema.parse(selection.identity.executionId), async ({ original, start, job }) => {
    if (original.binding || original.unsupported || !original.closeReason || !start.logicalEnding || start.state !== 'ended' || !job
      || jsonHash(original.intent.identity) !== jsonHash(selection.identity) || original.intent.profileId !== selection.profileId
      || original.intent.profileRevision !== selection.profileRevision || job.firstReason !== original.closeReason || job.stop || job.closure || job.logicalResult)
      throw precondition('原未绑定 owner、AgentStart 与结束作业尚未闭合');
    return job;
  });
}
