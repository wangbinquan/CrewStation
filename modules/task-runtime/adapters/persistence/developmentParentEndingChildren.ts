import { TaskIdSchema } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { conflict } from '@crewstation/kernel';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { DevelopmentParentEndingChild, DevelopmentParentEndingChildren, DevelopmentParentEndingObjects } from '../../ports/developmentParentEnding';
import { developmentParentEndingChildren as children, developmentParentEndingObjects as objects } from './developmentParentEndingTables';

export function drizzleDevelopmentParentEndingChildren(db: Executor): DevelopmentParentEndingChildren {
  const read = (row: typeof children.$inferSelect): DevelopmentParentEndingChild => ({ ...row, childId: TaskIdSchema.parse(row.childId) });
  return {
    page: async (endingId, afterId) => (await db.select().from(children).where(and(eq(children.endingId, endingId), eq(children.closed, false), afterId ? gt(children.childId, afterId) : undefined)).orderBy(asc(children.childId)).limit(25)).map(read),
    remaining: async (endingId) => {
      const rows = await db.execute(sql`SELECT count(*)::bigint AS count FROM task_runtime.development_parent_ending_children WHERE ending_id=${endingId} AND NOT closed`);
      return Number(rows[0]?.['count'] ?? 0);
    },
    close: async (endingId, childId, closure) => (await db.update(children).set({ closed: true, closure }).where(and(eq(children.endingId, endingId), eq(children.childId, childId), eq(children.closed, false))).returning({ childId: children.childId })).length === 1,
  };
}
export function drizzleDevelopmentParentEndingObjects(db: Executor): DevelopmentParentEndingObjects {
  return {
    insert: async (object) => {
      const existing = (await db.select().from(objects).where(and(eq(objects.endingId, object.endingId), eq(objects.kind, object.kind), eq(objects.namespace, object.namespace), eq(objects.name, object.name))))[0];
      if (existing) {
        if (existing.uid !== object.uid || existing.materialsHash !== object.materialsHash) throw conflict('原父物理对象身份不可替换');
        return;
      }
      await db.insert(objects).values(object);
    },
    list: async (endingId) => db.select().from(objects).where(eq(objects.endingId, endingId)).orderBy(asc(objects.kind), asc(objects.name)),
    matches: async (kind, namespace, name) => db.select().from(objects).where(and(eq(objects.kind, kind), eq(objects.namespace, namespace), eq(objects.name, name))).limit(2),
    absent: async (object, witness) => (await db.update(objects).set({ absence: witness }).where(and(eq(objects.endingId, object.endingId), eq(objects.kind, object.kind), eq(objects.namespace, object.namespace), eq(objects.name, object.name), eq(objects.uid, object.uid), eq(objects.materialsHash, object.materialsHash), isNull(objects.absence))).returning({ name: objects.name })).length === 1,
  };
}
