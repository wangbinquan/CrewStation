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
    liveUnfinished: async (endingId) => {
      const rows = await db.execute(sql`SELECT count(*)::bigint AS count FROM task_runtime.development_parent_ending_children member
        LEFT JOIN task_runtime.environments child ON child.id=member.child_id WHERE member.ending_id=${endingId}
        AND (child.id IS NULL OR child.native->>'state' IS DISTINCT FROM 'finished'
          OR child.project_id IS DISTINCT FROM member.snapshot->>'project_id' OR child.service_id IS DISTINCT FROM member.snapshot->>'service_id'
          OR child.namespace IS DISTINCT FROM member.snapshot->>'namespace' OR child.pod_name IS DISTINCT FROM member.snapshot->>'pod_name'
          OR child.pvc_name IS DISTINCT FROM member.snapshot->>'pvc_name'
          OR (CASE WHEN jsonb_typeof(child.render)='object' THEN child.render-'runtimeConnectionDeadline'-'runtimeInitializationDeadline' ELSE COALESCE(child.render,'null'::jsonb) END) IS DISTINCT FROM member.snapshot->'render'
          OR jsonb_build_array(child.native->'parentTaskId',child.native->'parentPodUid',child.native->'pvcUid',child.native->'nodeName',
            child.native->'runnerId',child.native->'agentId',child.native->'terminalId',child.native->'fingerprint',child.native->'profile',child.native->'image',child.native->'purpose')
            IS DISTINCT FROM jsonb_build_array(member.snapshot->'native'->'parentTaskId',member.snapshot->'native'->'parentPodUid',member.snapshot->'native'->'pvcUid',
            member.snapshot->'native'->'nodeName',member.snapshot->'native'->'runnerId',member.snapshot->'native'->'agentId',member.snapshot->'native'->'terminalId',
            member.snapshot->'native'->'fingerprint',member.snapshot->'native'->'profile',member.snapshot->'native'->'image',member.snapshot->'native'->'purpose')
          OR member.closure->>'kind'='protected-closed' AND child.native->'developmentCleanup' IS DISTINCT FROM member.closure->'numericEvidence')`);
      return Number(rows[0]?.['count'] ?? 0);
    },
    summary: async (endingId) => {
      const rows = await db.execute(sql`SELECT count(*)::bigint AS count, count(*) FILTER(WHERE closed)::bigint AS closed,
        encode(sha256(convert_to(COALESCE(string_agg(child_id || chr(10) || snapshot::text || chr(10) || COALESCE(closure::text, 'null'), chr(10) ORDER BY child_id), ''), 'UTF8')), 'hex') AS digest
        FROM task_runtime.development_parent_ending_children WHERE ending_id=${endingId}`);
      return { count: Number(rows[0]?.['count'] ?? 0), closed: Number(rows[0]?.['closed'] ?? 0), digest: String(rows[0]?.['digest'] ?? '') };
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
