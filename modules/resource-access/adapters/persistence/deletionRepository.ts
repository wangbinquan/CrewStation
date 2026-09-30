import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionTarget } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { ResourceAccessDeletionRepository } from '../../ports/deletion';
import { resourceAccessAdmissionKey } from './projectAdmission';
import { applicationWorkPending } from './applicationWork';
import { resourceAccessDeletionRecovery } from './deletionRecovery';

async function registered(db: Executor) {
  const rows = await db.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.tables WHERE table_schema='resource_access' AND table_type='BASE TABLE'`);
  if (rows.some((r) => !['changes', 'catalog_policies', 'deletion_fences', 'deletion_identities', 'deletion_work'].includes(r.table_name))) throw precondition('资源申请模块存在未登记的内容表');
}
async function inspect(db: Executor, target: ProjectDeletionTarget): Promise<ProjectDeletionInventory> {
  await registered(db);
  const [row] = await db.execute<{ count: string; fingerprint: string }>(sql`SELECT count(*)::text AS count,md5(coalesce(string_agg(md5(content::text),',' ORDER BY md5(content::text)),'')) AS fingerprint FROM resource_access.changes content WHERE project_id=${target.id}`);
  const count = Number(row?.count); if (!row?.fingerprint || !Number.isSafeInteger(count) || count < 0) throw precondition('资源申请内容盘点不完整');
  const resources = [{ kind: 'changes', id: target.id, identity: jsonHash({ count, fingerprint: row.fingerprint }), count, scope: 'metadata' as const }];
  const work = await db.execute<{ change_id: string }>(sql`SELECT change_id FROM resource_access.deletion_work WHERE project_id=${target.id} ORDER BY change_id`);
  resources.push({ kind: 'application-work', id: target.id, identity: jsonHash(work), count: work.length, scope: 'metadata' });
  return { participant: 'resource-access', revision: jsonHash(resources), complete: true, resources, references: [], blockers: [] };
}
async function lock(db: Executor, context: ProjectDeletionContext) {
  await db.execute(sql`INSERT INTO resource_access.deletion_fences(project_id) VALUES (${context.target.id}) ON CONFLICT DO NOTHING`);
  const [row] = await db.execute<{ operation_id: string | null; generation: number; confirmed_revision: string | null; scope_verified: boolean }>(sql`SELECT operation_id,generation,confirmed_revision,scope_verified FROM resource_access.deletion_fences WHERE project_id=${context.target.id} FOR UPDATE`);
  if (!row || row.operation_id && row.operation_id !== context.operationId || row.generation > context.generation) throw precondition('资源申请删除许可的操作或世代不符');
  return row;
}
export function resourceAccessDeletionRepository(db: Database, assertGrant: (context: ProjectDeletionContext) => Promise<void>): ResourceAccessDeletionRepository {
  const sealedWork = (context: ProjectDeletionContext, purge = false) => db.transaction(async (tx) => {
    const row = await lock(tx, context); await assertGrant(context); await registered(tx);
    if (row.operation_id !== context.operationId || row.confirmed_revision !== context.confirmed.revision || !row.scope_verified) throw precondition('资源申请闭准入屏障未完成');
    if (await applicationWorkPending(tx, context.target.id)) throw precondition('资源申请仍有持久在途应用，不能清理或证明已退出');
    await tx.execute(sql`UPDATE resource_access.deletion_fences SET generation=${context.generation} WHERE project_id=${context.target.id}`);
    if (purge) {
      await tx.execute(sql`SELECT set_config('crewstation.resource_access_deletion',${context.operationId},true)`);
      await tx.execute(sql`DELETE FROM resource_access.changes WHERE project_id=${context.target.id}`);
      await tx.execute(sql`DELETE FROM resource_access.deletion_work WHERE project_id=${context.target.id}`);
      if ((await inspect(tx, context.target)).resources.some((r) => r.count !== 0)) throw precondition('资源申请清理未归零');
    }
  });
  return {
    ...resourceAccessDeletionRecovery(db, assertGrant),
    inspect: (target) => inspect(db, target),
    seal: (context) => withExclusiveDatabaseAdmission(db, resourceAccessAdmissionKey(context.target.id), async (tx) => {
      const row = await lock(tx, context); await assertGrant(context); await registered(tx);
      const renewed = Boolean(row.operation_id && !row.scope_verified && row.generation < context.generation && row.confirmed_revision !== context.confirmed.revision);
      if (row.operation_id && row.confirmed_revision !== context.confirmed.revision && !renewed) throw precondition('资源申请确认材料不能替换');
      const pending = await applicationWorkPending(tx, context.target.id);
      if (row.operation_id && !renewed) return row.scope_verified ? pending ? 'waiting' : 'sealed' : 'changed';
      const current = await inspect(tx, context.target), verified = current.revision === context.confirmed.revision;
      await tx.execute(sql`UPDATE resource_access.deletion_fences SET operation_id=${context.operationId},generation=${context.generation},confirmed_revision=${context.confirmed.revision},scope_verified=${verified} WHERE project_id=${context.target.id}`);
      return !verified ? 'changed' : pending ? 'waiting' : 'sealed';
    }),
    assertSealed: (context) => sealedWork(context), purge: (context) => sealedWork(context, true),
  };
}
