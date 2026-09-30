import type { ProjectDeletionContext } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { EventsDeletionRepository } from '../../../ports/deletion';
import { eventsAdmissionKey } from '../projectAdmission';
import { deliveryWorkPending } from '../deliveryWork';
import { inspect, registered } from './inspection';
import { CONTENT, owned, typeIds } from './scope';

async function lock(db: Executor, context: ProjectDeletionContext) {
  await db.execute(sql`INSERT INTO events.deletion_fences(project_id) VALUES (${context.target.id}) ON CONFLICT DO NOTHING`);
  const [row] = await db.execute<{ operation_id: string | null; generation: number; confirmed_revision: string | null; scope_verified: boolean }>(sql`SELECT operation_id,generation,confirmed_revision,scope_verified FROM events.deletion_fences WHERE project_id=${context.target.id} FOR UPDATE`);
  if (!row || row.operation_id && row.operation_id !== context.operationId || row.generation > context.generation) throw precondition('事件清理操作或世代不符');
  return row;
}
export function eventsDeletionRepository(db: Database, assertGrant: (context: ProjectDeletionContext) => Promise<void>): EventsDeletionRepository {
  const sealed = (context: ProjectDeletionContext, purge = false) => db.transaction(async (tx) => {
    const row = await lock(tx,context); await assertGrant(context); await registered(tx);
    if (row.operation_id !== context.operationId || row.confirmed_revision !== context.confirmed.revision || !row.scope_verified) throw precondition('事件持久闭准入屏障未完成');
    if (await deliveryWorkPending(tx,context.target.id)) throw precondition('原事件投递仍有持久在途事实，不能清理或证明退出');
    await tx.execute(sql`UPDATE events.deletion_fences SET generation=${context.generation} WHERE project_id=${context.target.id}`);
    if (!purge) return;
    await tx.execute(sql`SELECT set_config('crewstation.events_deletion',${context.operationId},true)`);
    await tx.execute(sql`UPDATE events.subscriptions SET state='paused',updated_at=now() WHERE event_type_id IN (${typeIds(context.target)}) AND project_id<>${context.target.id} AND state<>'paused'`);
    for (const table of [...CONTENT].reverse()) await tx.execute(sql`DELETE FROM ${sql.identifier('events')}.${sql.identifier(table)} WHERE ${owned(table,context.target)}`);
    if ((await inspect(tx,context.target)).resources.some((r) => r.count !== 0)) throw precondition('事件内容清理未归零');
  });
  return { inspect: (target) => inspect(db,target),assertSealed: (context) => sealed(context),purge: (context) => sealed(context,true),
    seal: (context) => withExclusiveDatabaseAdmission(db,eventsAdmissionKey(context.target.id),async (tx) => {
      const row = await lock(tx,context); await assertGrant(context); await registered(tx);
      const renewed = Boolean(row.operation_id && !row.scope_verified && row.generation < context.generation && row.confirmed_revision !== context.confirmed.revision);
      if (row.operation_id && row.confirmed_revision !== context.confirmed.revision && !renewed) throw precondition('事件确认材料不能替换');
      const pending = await deliveryWorkPending(tx,context.target.id);
      if (row.operation_id && !renewed) return row.scope_verified ? pending ? 'waiting' : 'sealed' : 'changed';
      const current = await inspect(tx,context.target),verified = current.complete && current.revision === context.confirmed.revision;
      await tx.execute(sql`UPDATE events.deletion_fences SET operation_id=${context.operationId},generation=${context.generation},confirmed_revision=${context.confirmed.revision},scope_verified=${verified} WHERE project_id=${context.target.id}`);
      return !verified ? 'changed' : pending ? 'waiting' : 'sealed';
    }) };
}
