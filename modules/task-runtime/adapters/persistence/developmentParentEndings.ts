import { ProjectIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { and, asc, eq, gt, inArray, lte, ne, sql } from 'drizzle-orm';
import { DevelopmentParentEpochSchema, DevelopmentParentEndingPhaseSchema, developmentParentEpochHash } from '../../domain/development/parentEnding';
import { DevelopmentParentRetentionTransitionSchema, originalParentCompletion } from '../../domain/development/parentCompletion';
import type { DevelopmentParentEnding, DevelopmentParentEndingIdentity, DevelopmentParentEndingRepository, DevelopmentParentRebuildClaim, DevelopmentParentRebuildClaims } from '../../ports/developmentParentEnding';
import { developmentParentEndings as endings, developmentParentRebuildClaims as claims } from './developmentParentEndingTables';

function batchLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1) throw precondition('父退出恢复预算无效');
  return Math.min(25, limit);
}
function endingRow(row: typeof endings.$inferSelect): DevelopmentParentEnding {
  const epoch = DevelopmentParentEpochSchema.parse(row.epoch);
  if (!row.membershipFrozen || row.membershipRevision !== 1 || developmentParentEpochHash(epoch) !== row.epochHash)
    throw precondition('原开发父结束身份或固定成员无效', { code: 'development_parent_ending_invalid' });
  return { ...row, parentId: TaskIdSchema.parse(row.parentId), projectId: ProjectIdSchema.parse(row.projectId), epoch,
    phase: DevelopmentParentEndingPhaseSchema.parse(row.phase), membershipRevision: 1, membershipFrozen: true };
}
/** Call only within the owning project transaction; the database freezes the complete accepted set. */
async function admitEnding(db: Executor, identity: DevelopmentParentEndingIdentity, now: Date): Promise<DevelopmentParentEnding> {
  if (developmentParentEpochHash(identity.epoch) !== identity.epochHash || identity.epoch.parentId !== identity.parentId || identity.epoch.projectId !== identity.projectId)
    throw precondition('原开发父结束受理身份不一致');
  const inserted = await db.insert(endings).values({ ...identity, phase: 'admission-sealed', status: 'pending', membershipRevision: 1, memberCount: 0,
    membershipFrozen: false, progress: {}, retryAt: now, createdAt: now, updatedAt: now }).onConflictDoNothing().returning({ id: endings.id });
  if (inserted.length !== 1) throw conflict('原开发父已有结束受理');
  await db.execute(sql`INSERT INTO task_runtime.development_parent_ending_children(ending_id,child_id,original_parent_pod_uid,snapshot)
    SELECT ${identity.id},child.id,child.native->>'parentPodUid',to_jsonb(child) || jsonb_build_object('renderPresent',child.render IS NOT NULL,'render',CASE WHEN jsonb_typeof(child.render)='object' THEN child.render-'runtimeConnectionDeadline'-'runtimeInitializationDeadline' ELSE child.render END)
    FROM task_runtime.environments AS child WHERE child.native->>'parentTaskId'=${identity.parentId}`);
  const rows = await db.update(endings).set({ memberCount: sql`(SELECT count(*) FROM task_runtime.development_parent_ending_children WHERE ending_id=${identity.id})`, membershipFrozen: true }).where(eq(endings.id, identity.id)).returning();
  return endingRow(rows[0]!);
}
export function drizzleDevelopmentParentEndings(db: Executor): DevelopmentParentEndingRepository {
  return {
    get: async (id, lock = false) => {
      const query = db.select().from(endings).where(eq(endings.id, id)), row = (await (lock ? query.for('update') : query))[0];
      return row ? endingRow(row) : undefined;
    },
    active: async (parentId, epochHash) => {
      const row = (await db.select().from(endings).where(and(eq(endings.parentId, parentId), eq(endings.epochHash, epochHash), ne(endings.phase, 'complete'))).limit(1))[0];
      return row ? endingRow(row) : undefined;
    },
    admit: (identity, now) => admitEnding(db, identity, now),
    progress: async (id, expected, next, now) => (await db.update(endings).set({ ...next, updatedAt: now }).where(and(eq(endings.id, id), eq(endings.phase, expected), ne(endings.phase, 'complete'), eq(endings.membershipFrozen, true))).returning({ id: endings.id })).length === 1,
    recordRetentionTransition: async (source, raw) => {
      const receipt = DevelopmentParentRetentionTransitionSchema.parse(raw), witness = originalParentCompletion(source.completionWitness, source);
      if (witness.outcome !== 'compensation' || receipt.endingId !== source.id || receipt.epochHash !== source.epochHash
        || receipt.sourceCompletionWitnessHash !== jsonHash(witness) || receipt.beforeTransitionHash !== witness.afterTransitionHash
        || receipt.runnerTokenHash !== witness.runnerTokenHash || receipt.resource.id !== String(source.parentId)
        || receipt.resource.ownerRef !== source.parentId || receipt.resource.projectId !== source.projectId) throw precondition('原父保留期接续来源不可替换');
      return (await db.update(endings).set({ progress: sql`jsonb_set(${endings.progress}, '{retentionTransition}', ${JSON.stringify(receipt)}::jsonb, true)` }).where(and(eq(endings.id, source.id), eq(endings.parentId, source.parentId), eq(endings.projectId, source.projectId),
        eq(endings.epochHash, source.epochHash), eq(endings.phase, 'complete'), eq(endings.status, 'complete'), eq(endings.membershipFrozen, true),
        sql`jsonb_typeof(${endings.progress})='object'`, sql`NOT (${endings.progress} ? 'retentionTransition')`,
        sql`${endings.completionWitness}=${JSON.stringify(source.completionWitness)}::jsonb`)).returning({ id: endings.id })).length === 1;
    },
    due: async (afterId, cutoff, limit) => (await db.select({ id: endings.id }).from(endings).where(and(ne(endings.status, 'complete'), lte(endings.retryAt, cutoff), afterId ? gt(endings.id, afterId) : undefined)).orderBy(asc(endings.id)).limit(batchLimit(limit))).map((r) => r.id),
  };
}
function claimMatch(expected: DevelopmentParentRebuildClaim) {
  return and(eq(claims.sourceEndingId, expected.sourceEndingId), eq(claims.currentRebuildId, expected.currentRebuildId), eq(claims.revision, expected.revision), eq(claims.afterTransitionHash, expected.afterTransitionHash), eq(claims.state, expected.state));
}
export function drizzleDevelopmentParentRebuildClaims(db: Executor): DevelopmentParentRebuildClaims {
  return {
    get: async (id, lock = false) => {
      const query = db.select().from(claims).where(eq(claims.sourceEndingId, id)); return (await (lock ? query.for('update') : query))[0];
    },
    byRequest: async (id) => (await db.select().from(claims).where(eq(claims.currentRebuildId, id)).limit(1))[0],
    insert: async (claim) => (await db.insert(claims).values(claim).onConflictDoNothing().returning({ id: claims.sourceEndingId })).length === 1,
    replace: async (expected, next) => {
      if (expected.state === 'published' || next.sourceEndingId !== expected.sourceEndingId || next.afterTransitionHash !== expected.afterTransitionHash || next.revision !== expected.revision + 1 || next.state !== 'pending') return false;
      return (await db.update(claims).set(next).where(and(claimMatch(expected), inArray(claims.state, ['pending', 'released']))).returning({ id: claims.sourceEndingId })).length === 1;
    },
    publish: async (expected) => expected.state === 'pending' && (await db.update(claims).set({ state: 'published' }).where(claimMatch(expected)).returning({ id: claims.sourceEndingId })).length === 1,
    retry: async (expected, retryAt) => expected.state === 'pending' && (await db.update(claims).set({ retryAt }).where(claimMatch(expected)).returning({ id: claims.sourceEndingId })).length === 1,
    due: async (afterId, cutoff, limit) => db.select().from(claims).where(and(eq(claims.state, 'pending'), lte(claims.retryAt, cutoff), afterId ? gt(claims.sourceEndingId, afterId) : undefined)).orderBy(asc(claims.sourceEndingId)).limit(batchLimit(limit)),
  };
}
