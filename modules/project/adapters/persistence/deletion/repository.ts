import { ProjectDeletionOperationSchema, ProjectDeletionPlanSchema } from '@crewstation/contracts';
import type { ProjectId, UserId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, eq, gt, lte, or, sql } from 'drizzle-orm';
import type { DeletionOperationRecord } from '../../../domain/deletion/records';
import type { ProjectDeletions } from '../../../ports/deletion';
import { toProject } from '../drizzleProjectRepositories';
import { projects } from '../tables';
import { deletionOperations, deletionPlans } from './tables';
import { inspectProjectMetadata, projectMetadataCount, purgeProjectMetadata } from './metadata';
import { notFound } from '@crewstation/kernel';

function record(row: typeof deletionOperations.$inferSelect | undefined): DeletionOperationRecord | undefined {
  return row ? { operation: ProjectDeletionOperationSchema.parse(row.body), planId: row.planId, requestKey: row.requestKey,
    requestedBy: row.requestedBy as UserId, generation: row.generation, ...(row.leaseOwner ? { leaseOwner: row.leaseOwner } : {}), ...(row.leaseUntil ? { leaseUntil: row.leaseUntil } : {}) } : undefined;
}
function operationRow(item: DeletionOperationRecord): typeof deletionOperations.$inferInsert {
  return { id: item.operation.id, projectId: item.operation.project.id, planId: item.planId, requestKey: item.requestKey,
    requestedBy: item.requestedBy, body: item.operation, generation: item.generation, leaseOwner: item.leaseOwner ?? null, leaseUntil: item.leaseUntil ?? null };
}
export function drizzleProjectDeletions(db: Executor): ProjectDeletions {
  const find = async (where: ReturnType<typeof eq>) => record((await db.select().from(deletionOperations).where(where))[0]);
  return {
    lockProject: async (id) => { const row = (await db.select().from(projects).where(eq(projects.id, id)).for('update'))[0]; return row ? toProject(row) : undefined; },
    getPlan: async (id) => { const row = (await db.select().from(deletionPlans).where(eq(deletionPlans.id, id)))[0]; return row ? { plan: ProjectDeletionPlanSchema.parse(row.body), requestedBy: row.requestedBy as UserId, createdAt: row.createdAt } : undefined; },
    insertPlan: async (item) => { await db.insert(deletionPlans).values({ id: item.plan.id, projectId: item.plan.target.id, body: item.plan, requestedBy: item.requestedBy, createdAt: item.createdAt, expiresAt: new Date(item.plan.expiresAt) }); },
    getOperation: async (id, lock) => { const query = db.select().from(deletionOperations).where(eq(deletionOperations.id, id));
      return record((await (lock === 'available' ? query.for('update', { skipLocked: true }) : lock ? query.for('update') : query))[0]); },
    withExecutor: (work) => work(db),
    findOperation: (id) => find(eq(deletionOperations.projectId, id)),
    findRequest: async (key) => record((await db.select().from(deletionOperations).where(or(eq(deletionOperations.requestKey, key),
      sql`EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(${deletionOperations.body}->'confirmations','[]'::jsonb)) AS confirmation WHERE confirmation->>'requestKey'=${key})`)))[0]),
    lockRequest: async (key) => { await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`project.deletion-confirmation:${key}`},0))`); },
    insertOperation: async (item) => { await db.insert(deletionOperations).values(operationRow(item)); },
    saveOperation: async (item) => { await db.update(deletionOperations).set(operationRow(item)).where(eq(deletionOperations.id, item.operation.id)); },
    renewOperation: async (lease, now, until) => (await db.update(deletionOperations).set({ leaseUntil: until }).where(and(
      eq(deletionOperations.id, lease.operationId), eq(deletionOperations.leaseOwner, lease.owner), eq(deletionOperations.generation, lease.generation),
      gt(deletionOperations.leaseUntil, now), sql`${deletionOperations.body}->>'state' = 'running'`)).returning({ id: deletionOperations.id })).length === 1,
    markDeleting: async (id, at) => { await db.update(projects).set({ state: 'deleting', updatedAt: at, message: null }).where(eq(projects.id, id)); },
    lifecycleRevision: async (id) => { const row = (await db.select({ revision: projects.lifecycleRevision }).from(projects).where(eq(projects.id, id)))[0]; if (!row) throw notFound('项目', id); return row.revision.toString(); },
    listPending: async (now, after, limit = 100) => (await db.select({ id: deletionOperations.id }).from(deletionOperations)
      .where(and(sql`${deletionOperations.body}->>'state' IN ('accepted', 'running')`, after ? gt(deletionOperations.id, after) : undefined,
        or(sql`${deletionOperations.leaseUntil} IS NULL`, lte(deletionOperations.leaseUntil, now)))).orderBy(deletionOperations.id).limit(Math.min(200, Math.max(1, limit)))).map((r) => r.id),
    inspectMetadata: (id) => inspectProjectMetadata(db, id), purgeMetadata: (id, operationId) => purgeProjectMetadata(db, id, operationId), metadataCount: (id) => projectMetadataCount(db, id),
    finish: async (id: ProjectId, operationId) => {
      await purgeProjectMetadata(db, id, operationId);
      await db.delete(deletionPlans).where(eq(deletionPlans.projectId, id));
      await db.delete(projects).where(and(eq(projects.id, id), eq(projects.state, 'deleting')));
    },
  };
}
