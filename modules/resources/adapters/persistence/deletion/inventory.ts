import type { ProjectDeletionInventory, ProjectId } from '@crewstation/contracts';
import type { Database, Executor } from '@crewstation/persistence';
import { jsonHash, precondition } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';
import { CONTENT, contentWhere, registered, resourceIds } from './scope';
import type { NativePostgresChild, NativePostgresHistory, NativePostgresHistoryRecord } from '../../../api/projectDeletion';

export async function inspectLedgerDeletion(db: Executor, projectId: ProjectId, namespace: string): Promise<ProjectDeletionInventory> {
  await registered(db); const resources = [];
  for (const table of CONTENT) {
    // 记录归属与期望是范围；状态、时钟和关闭消费者的进展不能改变原资源身份。
    const material = table === 'records' ? sql`jsonb_build_object('id',id,'kind',kind,'project_id',project_id,'parent_id',parent_id,'owner_module',owner_module,'owner_ref',owner_ref,'spec',spec)::text` : sql`content::text`;
    const rows = await db.execute<{ count: string; fingerprint: string }>(sql`SELECT count(*)::text AS count, md5(coalesce(string_agg(md5(${material}), ',' ORDER BY md5(${material})), '')) AS fingerprint FROM ${sql.identifier('resources')}.${sql.identifier(table)} content WHERE ${contentWhere(table, projectId, namespace)}`);
    const count = Number(rows[0]?.count), fingerprint = rows[0]?.fingerprint;
    if (!Number.isSafeInteger(count) || count < 0 || !fingerprint) throw precondition('资源台账盘点不完整');
    resources.push({ kind: `metadata:${table}`, id: projectId, count, identity: jsonHash({ table, count, fingerprint }), scope: 'metadata' as const });
  }
  const external = await db.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM resources.records WHERE project_id IS DISTINCT FROM ${projectId} AND (parent_id IN ${resourceIds(projectId)} OR id IN (SELECT resource_id FROM resources.workload_consumers WHERE namespace = ${namespace}))`);
  const blockers: ProjectDeletionInventory['blockers'] = Number(external[0]?.count) ? [{ participant: 'resources', code: 'shared-resource', message: '其他项目的资源仍引用本项目父记录；需先解除跨项目依赖' }] : [];
  return { participant: 'resources', complete: true, resources, revision: jsonHash(resources), references: [], blockers };
}

const nativeKinds = ['PostgresDatabase', 'PostgresRole'];
type NativeRow = { id: string; kind: string; owner_module: string; owner_ref: string; desired: string; phase: string; version: string; generation: number; compacted: boolean; spec: unknown };
type NativeChildRow = { resource_id: string; kind: NativePostgresChild['kind']; namespace: string; name: string; uid: string | null; expected: boolean };

function nativeDeclarations(spec: unknown): NativePostgresChild[] | undefined {
  if (!spec || typeof spec !== 'object' || !('children' in spec) || !Array.isArray(spec.children)) return undefined;
  const result: NativePostgresChild[] = [];
  for (const child of spec.children) {
    if (!child || typeof child !== 'object' || typeof child.kind !== 'string' || typeof child.name !== 'string' || !child.name) return undefined;
    if (!nativeKinds.includes(child.kind)) continue;
    if (child.namespace !== undefined && child.namespace !== '') return undefined;
    result.push({ kind: child.kind as NativePostgresChild['kind'], name: child.name });
  }
  return result;
}

function nativeHistoryRecord(row: NativeRow, children: NativeChildRow[], gaps: NativePostgresHistory['gaps'][number][]): NativePostgresHistoryRecord {
  const declared = nativeDeclarations(row.spec), version = Number(row.version);
  if (!row.id || !Number.isSafeInteger(version) || version < 1 || !Number.isSafeInteger(row.generation) || row.generation < 1) throw precondition('原生历史台账的原键或版本不可核实');
  const gap = (code: NativePostgresHistory['gaps'][number]['code'], message: string) => { gaps.push({ resourceId: row.id, code, message }); };
  if (row.compacted) gap('native-identity-compacted', '保留台账已压缩并清空原生子身份；需原独立持久事实补齐，不能判定原实体归零');
  else if (version > 1) gap('native-revisions-unavailable', '保留台账没有旧版本正文；需原生持久事实覆盖全部旧声明和 OID，不能仅凭变更计数判定完整');
  if (!declared || children.some((child) => !child.name || child.namespace || child.uid !== null && !/^[1-9]\d*$/.test(child.uid))) gap('native-declaration-invalid', '原生声明、命名空间或观测 OID 无法完整解读');
  if (!['database', 'data-binding'].includes(row.kind) || row.owner_module !== 'data') gap('native-owner-unknown', '原生子对象不属于已登记的数据资源声明；需先核实其原所有者');
  return {
    id: row.id, kind: row.kind, owner: { module: row.owner_module, ref: row.owner_ref }, desired: row.desired, phase: row.phase,
    version, generation: row.generation, compacted: row.compacted, spec: row.spec, declared: declared ?? [],
    observed: children.map((child) => ({ kind: child.kind, name: child.name, ...(child.namespace ? { namespace: child.namespace } : {}), ...(child.uid !== null ? { uid: child.uid } : {}), expected: child.expected })),
  };
}

export function readNativePostgresHistory(db: Database, projectId: ProjectId): Promise<NativePostgresHistory> {
  return db.transaction(async (tx) => {
    const records: NativePostgresHistoryRecord[] = [], gaps: NativePostgresHistory['gaps'][number][] = [];
    let after: string | undefined;
    for (;;) {
      const rows = await tx.execute<NativeRow>(sql`SELECT r.id,r.kind,r.owner_module,r.owner_ref,r.desired,r.phase,r.version::text AS version,r.generation,r.compacted_at IS NOT NULL AS compacted,r.spec
        FROM resources.records r WHERE r.project_id=${projectId} AND ${after === undefined ? sql`true` : sql`r.id>${after}`} AND (
          r.kind IN ('database','data-binding')
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.spec->'children')='array' THEN r.spec->'children' ELSE '[]'::jsonb END) c WHERE c->>'kind' IN ('PostgresDatabase','PostgresRole'))
          OR EXISTS (SELECT 1 FROM resources.children c WHERE c.resource_id=r.id AND c.kind IN ('PostgresDatabase','PostgresRole')))
        ORDER BY r.id LIMIT 500`);
      if (!rows.length) break;
      const children = await tx.execute<NativeChildRow>(sql`SELECT resource_id,kind,namespace,name,uid,expected FROM resources.children
        WHERE resource_id IN (${sql.join(rows.map((row) => sql`${row.id}`), sql`,`)}) AND kind IN ('PostgresDatabase','PostgresRole') ORDER BY resource_id,kind,namespace,name`);
      const byRecord = new Map<string, NativeChildRow[]>();
      for (const child of children) { const list = byRecord.get(child.resource_id) ?? []; list.push(child); byRecord.set(child.resource_id, list); }
      for (const row of rows) records.push(nativeHistoryRecord(row, byRecord.get(row.id) ?? [], gaps));
      if (rows.length < 500) break;
      after = rows.at(-1)!.id;
    }
    return { retainedRecordsComplete: true, records, gaps, revision: jsonHash({ projectId, records, gaps }) };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
