import { ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { RuntimeWorkOriginSchema } from '../../../domain/deletion/work';
import type { RuntimeWorkInput } from '../../../domain/deletion/work';
import type { RuntimeDeletionSources } from '../../../ports/deletion/sources';
import { runtimeInfrastructureOrigin } from '../infrastructure/origins';

interface OriginalRow extends Record<string, unknown> { id: string; project_id: string; revision: string; identity: string }
const minimum = (kind: RuntimeWorkInput['originKind'], value: ReturnType<typeof RuntimeWorkOriginSchema.parse>) => value.scope === 'project'
  ? { ...value, revision: jsonHash({ kind, id: value.id, projectId: value.projectIds[0] }) } : value;
export async function retainedRuntimeOrigin(db: Executor, kind: RuntimeWorkInput['originKind'], key: string) {
  const row = (await db.execute<OriginalRow>(sql`SELECT id,project_id,revision,identity FROM task_runtime.work_origins WHERE kind=${kind} AND key=${key}`))[0];
  if (!row) return undefined;
  const original = { kind, key, id: row.id, projectId: row.project_id, revision: row.revision };
  if (row.identity !== jsonHash(original)) throw precondition('运行原来源的最小沿革摘要不符');
  return RuntimeWorkOriginSchema.parse({ complete: true, id: row.id, scope: 'project', projectIds: [row.project_id], revision: row.revision });
}
/** The public original witness stays identical after this owner's payload is purged. */
export async function originalRuntimeWorkInfrastructure(db: Database, kind: 'task' | 'rebuild' | 'parent-ending', key: string, mode: 'current' | 'legacy' = 'current') {
  const actual = await runtimeInfrastructureOrigin(db, kind, key, mode), saved = await retainedRuntimeOrigin(db, kind, key);
  const original = actual ? minimum(kind, RuntimeWorkOriginSchema.parse(actual)) : saved;
  if (saved && original && jsonHash(saved) !== jsonHash(original)) throw precondition('运行公共原归属与最小沿革冲突');
  return original;
}
export async function registerRuntimeWorkOrigin(db: Executor, input: RuntimeWorkInput, origin: ReturnType<typeof RuntimeWorkOriginSchema.parse>) {
  const original = { kind: input.originKind, key: input.originKey, id: origin.id, projectId: input.projectId, revision: origin.revision }, identity = jsonHash(original);
  const existing = await retainedRuntimeOrigin(db, original.kind, original.key);
  if (existing) {
    if (jsonHash(existing) !== jsonHash(origin)) throw precondition('运行回调的原来源不能替换');
    return;
  }
  await db.execute(sql`SELECT set_config('crewstation.task_runtime_origin',${jsonHash({ ...original, identity })},true)`);
  await db.execute(sql`INSERT INTO task_runtime.work_origins(kind,key,id,project_id,revision,identity)
    VALUES(${original.kind},${original.key},${original.id},${original.projectId},${original.revision},${identity}) ON CONFLICT DO NOTHING`);
  const saved = await retainedRuntimeOrigin(db, original.kind, original.key);
  if (!saved || jsonHash(saved) !== jsonHash(origin)) throw precondition('运行回调的原来源不能替换');
}
/** Only original public service/project roots, actual owner records or an accepted never-provisioned business task establish scope. */
export async function runtimeWorkOrigin(db: Database, sources: RuntimeDeletionSources, kind: RuntimeWorkInput['originKind'], key: string) {
  const mode = ResourceIdSchema.safeParse(key).success ? 'current' : 'legacy';
  let actual = kind === 'project' || kind === 'service' ? await sources.resolve(kind, key, mode)
    : await originalRuntimeWorkInfrastructure(db, kind, key, mode);
  if (!actual && kind === 'task') actual = await sources.resolve('business-task', key, mode);
  const retained = await retainedRuntimeOrigin(db, kind, key);
  if (!actual && !retained) throw precondition('运行回调的原来源缺失');
  const resolved = RuntimeWorkOriginSchema.parse(actual ?? retained);
  const origin = minimum(kind, resolved);
  if (mode === 'current' && origin.id !== key || kind === 'project' && origin.id !== origin.projectIds[0]) throw precondition('运行回调原对象 ID 或项目不符');
  if (retained && jsonHash(retained) !== jsonHash(origin)) throw precondition('运行回调原来源被替换');
  return origin;
}
