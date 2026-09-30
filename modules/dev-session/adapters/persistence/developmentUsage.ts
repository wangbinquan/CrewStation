import { eq } from 'drizzle-orm';
import type { TaskId } from '@crewstation/contracts';
import type { Database } from '@crewstation/persistence';
import { conflict, jsonHash, notFound, precondition } from '@crewstation/kernel';
import type { DevelopmentUsageOwnerRecord, DevelopmentUsageOwnerStore, DevelopmentUsagePrepared } from '../../ports/developmentUsage';
import { DevelopmentUsageOwnerRecordSchema, DevelopmentUsagePreparedSchema } from '../../domain/developmentUsage';
import { developmentAgentUsage as table } from './developmentUsageTable';
import { agentStarts } from './agentStartTable';

type Row = typeof table.$inferSelect;
const record = (row: Row): DevelopmentUsageOwnerRecord => DevelopmentUsageOwnerRecordSchema.parse({ ...row.prepared, binding: row.binding, unsupported: row.unsupported, closeReason: row.closeReason });
function samePrepared(original: DevelopmentUsageOwnerRecord, incoming: DevelopmentUsagePrepared): void {
  // Two first callers can independently mint a nonce. Only the committed original survives.
  if (jsonHash({ intent: original.intent, context: original.context, price: original.price }) !== jsonHash({ intent: incoming.intent, context: incoming.context, price: incoming.price })) throw conflict('开发执行已有另一份稳定受理或人民币原价');
}
export function developmentUsageOwnerStore(db: Database): DevelopmentUsageOwnerStore {
  const change = (id: TaskId, apply: (current: DevelopmentUsageOwnerRecord) => DevelopmentUsageOwnerRecord) => db.transaction(async (tx) => {
    const row = (await tx.select().from(table).where(eq(table.executionTaskId, id)).for('update'))[0];
    if (!row) throw notFound('开发数字受理', id);
    const next = DevelopmentUsageOwnerRecordSchema.parse(apply(record(row)));
    await tx.update(table).set({ binding: next.binding, unsupported: next.unsupported, closeReason: next.closeReason }).where(eq(table.executionTaskId, id));
    return next;
  });
  return {
    prepare: (input) => db.transaction(async (tx) => {
      const prepared = DevelopmentUsagePreparedSchema.parse(input), identity = prepared.intent.identity;
      const previous = (await tx.select().from(table).where(eq(table.executionTaskId, identity.executionId)).for('update'))[0];
      if (previous) { const current = record(previous); samePrepared(current, prepared); return current; }
      // A cancellation during the external price call cannot create a later first admission.
      const start = (await tx.select().from(agentStarts).where(eq(agentStarts.executionTaskId, identity.executionId)).for('update'))[0];
      if (!start || start.state !== 'pending' || start.cancelled || start.finalized) throw precondition('开发执行已结束或首次派发已越过受理');
      await tx.insert(table).values({ executionTaskId: identity.executionId, projectId: identity.projectId, workspaceTaskId: identity.taskId, acceptedAt: prepared.price.acceptedAt, prepared }).onConflictDoNothing();
      const row = (await tx.select().from(table).where(eq(table.executionTaskId, identity.executionId)).for('update'))[0]!;
      const current = record(row); samePrepared(current, prepared); return current;
    }),
    get: async (id) => { const row = (await db.select().from(table).where(eq(table.executionTaskId, id)))[0]; return row ? record(row) : undefined; },
    bind: (id, binding) => change(id, (current) => {
      if (current.binding) { if (jsonHash(current.binding) !== jsonHash(binding)) throw conflict('原开发 journal/Pod 绑定不可替换'); return current; }
      if (current.closeReason || current.unsupported) throw precondition('开发受理已关闭或未支持数字日志');
      return { ...current, binding };
    }),
    unsupported: (id) => change(id, (current) => {
      if (current.binding || current.closeReason) throw precondition('已绑定或关闭的开发受理不能降级为旧 Runner');
      return { ...current, unsupported: true };
    }),
    close: (id, reason) => change(id, (current) => ({ ...current, closeReason: current.closeReason ?? reason })),
  };
}
