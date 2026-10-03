import { ResourceIdSchema } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { DevelopmentWorkOriginSchema } from '../../../domain/deletion/work';
import type { DevelopmentWorkInput } from '../../../domain/deletion/work';
import type { DevelopmentDeletionSources } from '../../../ports/deletion/sources';
import { DevelopmentContentSources } from './contentSources';

/** Before TaskRuntime materializes a reserved execution, only its one actual accepted parent can supply ownership. */
export async function developmentWorkOrigin(db: Executor, sources: DevelopmentDeletionSources, kind: DevelopmentWorkInput['originKind'], key: string) {
  const mode = ResourceIdSchema.safeParse(key).success ? 'current' : 'legacy';
  const original = await sources.resolve(kind, key, mode);
  if (original) {
    const origin = DevelopmentWorkOriginSchema.parse(original);
    if (mode === 'current' && origin.id !== key) throw precondition('开发回调与原对象 ID 不符');
    return origin;
  }
  if (kind !== 'task') throw precondition('开发回调的原公开来源缺失');
  const parents = await db.execute<{ task_id: string }>(sql`SELECT task_id FROM dev_session.agent_starts WHERE execution_task_id=${key}
    UNION ALL SELECT task_id FROM dev_session.native_terminal_starts WHERE execution_task_id=${key}`);
  if (parents.length !== 1) throw precondition('开发回调缺少唯一原受理父工作区');
  const parent = DevelopmentWorkOriginSchema.parse(await sources.resolve('task', parents[0]!.task_id, 'current'));
  if (parent.id !== parents[0]!.task_id) throw precondition('开发回调原父工作区已替换');
  return DevelopmentWorkOriginSchema.parse(await new DevelopmentContentSources(db, sources, parent.projectIds[0]!).resolve('task', key));
}
