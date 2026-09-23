import type { ClusterPurpose, ProjectId, ResourceChild, ResourceCondition, ResourceKind, ResourceOwner, ResourcePhase, ResourceReason, StartupRecord } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { and, asc, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { STABLE_KINDS } from '../../domain/kinds';
import type { LedgerRecord, RecordFilter, ResourceAlias, ResourceSpec } from '../../domain/record';
import { childKey } from '../../domain/record';
import type { RecordRepository, StoredChild } from '../../ports/repositories';
import { aliases, children, records } from './tables';

/** 记录里 status 列的形状：条件、启动进度、原因、展示字段。 */
interface StoredStatus {
  readonly conditions?: readonly ResourceCondition[];
  readonly startup?: StartupRecord;
  readonly reason?: ResourceReason;
  readonly display?: Readonly<Record<string, string>>;
}

interface ObservedChild {
  readonly phase: string;
  readonly ready: boolean;
  readonly reason?: string;
  readonly node?: string;
  readonly restarts?: number;
  readonly replicas?: number;
  readonly readyReplicas?: number;
  /** 对象的 metadata.generation（调和器照期望渲染的对象被人改动时，观测随之变化）。 */
  readonly generation?: number;
}

type RecordRow = typeof records.$inferSelect;
type ChildRow = typeof children.$inferSelect;

const optional = <K extends string, V>(key: K, value: V | null | undefined): { [P in K]?: V } => (value === null || value === undefined ? {} : { [key]: value }) as { [P in K]?: V };

function toChild(row: ChildRow): ResourceChild {
  const observed = row.observed as ObservedChild | null;
  return {
    kind: row.kind, ...optional('namespace', row.namespace || undefined), name: row.name, ...optional('uid', row.uid),
    phase: observed?.phase ?? 'absent', ready: observed?.ready ?? false,
    ...optional('reason', observed?.reason), ...optional('node', observed?.node), ...optional('restarts', observed?.restarts),
    ...optional('replicas', observed?.replicas), ...optional('readyReplicas', observed?.readyReplicas), ...optional('generation', observed?.generation),
    ...optional('observedAt', row.observedAt?.toISOString()),
  };
}

function toRecord(row: RecordRow, childRows: readonly ChildRow[], aliasRows: readonly (typeof aliases.$inferSelect)[]): LedgerRecord {
  const status = (row.status ?? {}) as StoredStatus;
  return {
    id: row.id, kind: row.kind as ResourceKind, ...optional('projectId', row.projectId as ProjectId | null), owner: { module: row.ownerModule, ref: row.ownerRef },
    ...optional('parentId', row.parentId), ...optional('purpose', row.purpose as ClusterPurpose | null), desired: row.desired as LedgerRecord['desired'],
    spec: row.spec as ResourceSpec, generation: row.generation, observedGeneration: row.observedGeneration, ...optional('releaseReason', row.releaseReason as ResourceReason | null),
    conditions: status.conditions ?? [], children: childRows.map(toChild), ...optional('startup', status.startup), display: status.display ?? {},
    phase: row.phase as ResourcePhase, phaseSince: row.phaseSince, ...optional('reason', status.reason), ...optional('idleSince', row.idleSince), ...optional('retainUntil', row.retainUntil),
    aliases: aliasRows.map((a) => ({ source: a.source as ResourceAlias['source'], alias: a.alias })), version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt,
    ...optional('compactedAt', row.compactedAt),
  };
}

function toRow(record: LedgerRecord): typeof records.$inferInsert {
  const status: StoredStatus = { conditions: record.conditions, display: record.display, ...optional('startup', record.startup), ...optional('reason', record.reason) };
  return {
    id: record.id, kind: record.kind, projectId: record.projectId ?? null, ownerModule: record.owner.module, ownerRef: record.owner.ref, parentId: record.parentId ?? null,
    purpose: record.purpose ?? null, desired: record.desired, spec: record.spec, generation: record.generation, observedGeneration: record.observedGeneration,
    releaseReason: record.releaseReason ?? null, status, phase: record.phase, phaseSince: record.phaseSince, idleSince: record.idleSince ?? null,
    retainUntil: record.retainUntil ?? null, version: record.version, createdAt: record.createdAt, updatedAt: record.updatedAt, compactedAt: record.compactedAt ?? null,
  };
}

function childRow(resourceId: string, stored: StoredChild): typeof children.$inferInsert {
  const { child } = stored;
  const observed: ObservedChild | null = child.phase === 'absent' && !child.uid ? null : {
    phase: child.phase, ready: child.ready, ...optional('reason', child.reason), ...optional('node', child.node), ...optional('restarts', child.restarts),
    ...optional('replicas', child.replicas), ...optional('readyReplicas', child.readyReplicas), ...optional('generation', child.generation),
  };
  return {
    resourceId, kind: child.kind, namespace: child.namespace ?? '', name: child.name, uid: child.uid ?? null, expected: stored.expected,
    observed, observedAt: child.observedAt ? new Date(child.observedAt) : null,
  };
}

/** postgres.js 的唯一约束冲突（可能被 drizzle 包在 cause 里）。 */
function uniqueViolation(error: unknown): { readonly constraint?: string } | undefined {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth += 1) {
    const candidate = current as { code?: string; constraint_name?: string; cause?: unknown };
    if (candidate.code === '23505') return { ...optional('constraint', candidate.constraint_name) };
    current = candidate.cause;
  }
  return undefined;
}

const STOPPED_PHASES = ['stopped'];

function filterOf(filter: RecordFilter) {
  return and(
    filter.projectId ? eq(records.projectId, filter.projectId) : undefined,
    filter.kind ? eq(records.kind, filter.kind) : undefined,
    filter.parentId ? eq(records.parentId, filter.parentId) : undefined,
    // 缺省不列已结束的一次性记录；稳定记录（服务槽）已结束也列（种类注册表的 stable）。
    filter.includeStopped ? undefined : or(notInArray(records.phase, STOPPED_PHASES), inArray(records.kind, [...STABLE_KINDS])),
  );
}

export function drizzleRecordRepository(db: Executor): RecordRepository {
  const hydrate = async (rows: readonly RecordRow[]): Promise<LedgerRecord[]> => {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const [childRows, aliasRows] = await Promise.all([
      db.select().from(children).where(inArray(children.resourceId, ids)).orderBy(asc(children.kind), asc(children.name)),
      db.select().from(aliases).where(inArray(aliases.resourceId, ids)).orderBy(asc(aliases.source), asc(aliases.alias)),
    ]);
    return rows.map((row) => toRecord(row, childRows.filter((c) => c.resourceId === row.id), aliasRows.filter((a) => a.resourceId === row.id)));
  };
  const one = async (where: ReturnType<typeof eq>, forUpdate?: boolean): Promise<LedgerRecord | undefined> => {
    const query = db.select().from(records).where(where);
    const rows = forUpdate ? await query.for('update') : await query;
    return (await hydrate(rows))[0];
  };
  return {
    get: (id, options) => one(eq(records.id, id), options?.forUpdate),
    getByOwner: (owner: ResourceOwner, kind, options) => one(and(eq(records.ownerModule, owner.module), eq(records.ownerRef, owner.ref), eq(records.kind, kind))!, options?.forUpdate),
    getMany: async (ids) => (ids.length ? hydrate(await db.select().from(records).where(inArray(records.id, [...ids]))) : []),
    list: async (filter: RecordFilter) => hydrate(await db.select().from(records).where(filterOf(filter))
      .orderBy(asc(records.createdAt), asc(records.id)).limit(Math.min(2000, Math.max(1, filter.limit ?? 2000)))),
    countByKindPhase: async (filter) => {
      const rows = await db.select({ kind: records.kind, phase: records.phase, count: sql<number>`count(*)::int` }).from(records).where(filterOf(filter)).groupBy(records.kind, records.phase);
      const counts: Record<string, Record<string, number>> = {};
      for (const row of rows) (counts[row.kind] ??= {})[row.phase] = Number(row.count);
      return counts;
    },
    compact: async (id, at) => {
      await db.delete(children).where(eq(children.resourceId, id));
      const rows = await db.update(records).set({ spec: { children: [] }, status: sql`jsonb_build_object('conditions', '[]'::jsonb, 'display', '{}'::jsonb) || CASE WHEN ${records.status} ? 'reason' THEN jsonb_build_object('reason', ${records.status}->'reason') ELSE '{}'::jsonb END`, compactedAt: at, updatedAt: at, version: sql`${records.version} + 1` })
        .where(and(eq(records.id, id), isNull(records.compactedAt))).returning({ id: records.id });
      return rows.length ? (await hydrate(await db.select().from(records).where(eq(records.id, id))))[0] : undefined;
    },
    insert: async (record) => { await db.insert(records).values(toRow(record)); },
    update: async (record) => { await db.update(records).set(toRow(record)).where(eq(records.id, record.id)); },
    replaceChildren: async (resourceId, next) => {
      const keys = next.map(({ child }) => childKey(child));
      const current = await db.select().from(children).where(eq(children.resourceId, resourceId));
      const gone = current.filter((row) => !keys.includes(childKey({ kind: row.kind, namespace: row.namespace || undefined, name: row.name })));
      for (const row of gone) await db.delete(children).where(and(eq(children.resourceId, resourceId), eq(children.kind, row.kind), eq(children.namespace, row.namespace), eq(children.name, row.name)));
      for (const stored of next) {
        const values = childRow(resourceId, stored);
        try {
          await db.insert(children).values(values).onConflictDoUpdate({ target: [children.resourceId, children.kind, children.namespace, children.name], set: { uid: values.uid, expected: values.expected, observed: values.observed, observedAt: values.observedAt } });
        } catch (error) {
          if (uniqueViolation(error)) throw conflict(`集群对象 ${childKey(stored.child)} 已属于另一条资源记录`, { resourceId, child: childKey(stored.child) });
          throw error;
        }
      }
    },
    findByChild: async (child) => {
      const byUid = child.uid ? (await db.select({ id: children.resourceId }).from(children).where(eq(children.uid, child.uid)).limit(1))[0] : undefined;
      if (byUid) return byUid.id;
      const row = (await db.select({ id: children.resourceId }).from(children).where(and(eq(children.kind, child.kind), eq(children.namespace, child.namespace ?? ''), eq(children.name, child.name))).limit(1))[0];
      return row?.id;
    },
    addAliases: async (resourceId, list) => {
      for (const alias of list) {
        const inserted = await db.insert(aliases).values({ resourceId, source: alias.source, alias: alias.alias }).onConflictDoNothing().returning({ id: aliases.resourceId });
        if (inserted.length) continue;
        const holder = (await db.select({ id: aliases.resourceId }).from(aliases).where(and(eq(aliases.source, alias.source), eq(aliases.alias, alias.alias))))[0];
        if (holder && holder.id !== resourceId) throw conflict(`别名 ${alias.source}:${alias.alias} 已属于另一条资源记录`, { resourceId, holder: holder.id });
      }
    },
    resolveAlias: async (alias) => (await db.select({ id: aliases.resourceId }).from(aliases).where(and(eq(aliases.source, alias.source), eq(aliases.alias, alias.alias))))[0]?.id,
    retentionDue: async (limit) => hydrate(await db.select().from(records)
      .where(and(lt(records.retainUntil, sql`now()`), eq(records.desired, 'present'), eq(records.phase, 'failed'))).orderBy(asc(records.retainUntil)).limit(limit)),
    // 只压缩终态：期望已是「不要了」且已结束。期望仍在、此刻已结束的（下线的服务槽、暂停的业务工作区、待回收的工作卷）不是终态。
    compactable: async (stoppedBefore, limit) => (await db.select({ id: records.id }).from(records)
      .where(and(eq(records.desired, 'absent'), eq(records.phase, 'stopped'), lt(records.phaseSince, stoppedBefore), isNull(records.compactedAt))).orderBy(asc(records.phaseSince)).limit(limit)).map((row) => row.id),
    countByKind: async (projectId, kinds, phases) => {
      if (!kinds.length || !phases.length) return {};
      const rows = await db.select({ kind: records.kind, count: sql<number>`count(*)::int` }).from(records)
        .where(and(eq(records.projectId, projectId), inArray(records.kind, [...kinds]), inArray(records.phase, [...phases])))
        .groupBy(records.kind);
      return Object.fromEntries(rows.map((row) => [row.kind, Number(row.count)]));
    },
  };
}
