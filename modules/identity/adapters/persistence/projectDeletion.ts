import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectId } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { IdentityDeletionRepository } from '../../ports/lifecycle/projectDeletion';

async function registered(db: Executor) {
  const rows = await db.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.columns WHERE table_schema = 'identity' AND column_name = 'project_id'`);
  if (rows.some((r) => !['identity_forwarding', 'deletion_fences'].includes(r.table_name))) throw precondition('身份模块存在未登记的项目内容表');
}
async function inspect(db: Executor, id: ProjectId): Promise<ProjectDeletionInventory> {
  await registered(db);
  const rows = await db.execute<{ count: string; fingerprint: string }>(sql`SELECT count(*)::text AS count,
    md5(coalesce(string_agg(md5(content::text), ',' ORDER BY md5(content::text)), '')) AS fingerprint FROM identity.identity_forwarding content WHERE project_id = ${id}`);
  const count = Number(rows[0]?.count), fingerprint = rows[0]?.fingerprint;
  if (!Number.isSafeInteger(count) || count < 0 || !fingerprint) throw precondition('项目身份转发盘点不完整');
  const resources = [{ kind: 'identity-forwarding', id, identity: jsonHash({ count, fingerprint }), count, scope: 'metadata' as const }];
  return { participant: 'identity', revision: jsonHash(resources), complete: true, resources, references: [], blockers: [] };
}
async function lock(db: Executor, context: ProjectDeletionContext) {
  await db.execute(sql`INSERT INTO identity.deletion_fences(project_id,project_slug) VALUES (${context.target.id},${context.target.slug}) ON CONFLICT DO NOTHING`);
  const rows = await db.execute<{ operation_id: string | null; generation: number; confirmed_revision: string | null }>(sql`SELECT operation_id,generation,confirmed_revision FROM identity.deletion_fences WHERE project_id = ${context.target.id} FOR UPDATE`);
  const row = rows[0];
  if (!row || (row.operation_id && row.operation_id !== context.operationId) || row.generation > context.generation) throw precondition('身份删除屏障的操作或世代不符'); return row;
}
export function identityProjectAdmissionRepository(db: Executor) {
  return {
    byId: async (id: ProjectId) => (await db.execute(sql`SELECT project_id FROM identity.deletion_fences WHERE project_id = ${id} AND operation_id IS NOT NULL`)).length === 0,
    bySlug: async (slug: string) => (await db.execute(sql`SELECT project_id FROM identity.deletion_fences WHERE project_slug = ${slug} AND operation_id IS NOT NULL LIMIT 1`)).length === 0,
  };
}
export function identityDeletionRepository(db: Database, assertGrant: (context: ProjectDeletionContext) => Promise<void>): IdentityDeletionRepository {
  const sealedWork = (context: ProjectDeletionContext, purge = false) => db.transaction(async (tx) => {
    const row = await lock(tx, context); await assertGrant(context);
    if (row.operation_id !== context.operationId || row.confirmed_revision !== context.confirmed.revision) throw precondition('身份持久闭准入屏障未完成');
    await tx.execute(sql`UPDATE identity.deletion_fences SET generation = ${context.generation} WHERE project_id = ${context.target.id}`);
    if (purge) {
      await registered(tx); await tx.execute(sql`SELECT set_config('crewstation.identity_deletion', ${context.operationId}, true)`);
      await tx.execute(sql`DELETE FROM identity.identity_forwarding WHERE project_id = ${context.target.id}`);
      if ((await inspect(tx, context.target.id)).resources.some((r) => r.count > 0)) throw precondition('身份转发清理未归零');
    }
  });
  return { inspect: (id) => inspect(db, id), assertSealed: (context) => sealedWork(context), purge: (context) => sealedWork(context, true),
    seal: (context) => db.transaction(async (tx) => {
      const row = await lock(tx, context); await assertGrant(context); const current = await inspect(tx, context.target.id);
      if (row.operation_id && row.confirmed_revision !== context.confirmed.revision && row.generation >= context.generation) throw precondition('身份确认摘要不能被替换');
      await tx.execute(sql`UPDATE identity.deletion_fences SET project_slug = ${context.target.slug}, operation_id = ${context.operationId}, generation = ${context.generation}, confirmed_revision = ${context.confirmed.revision} WHERE project_id = ${context.target.id}`);
      return current.revision === context.confirmed.revision;
    }),
  };
}
