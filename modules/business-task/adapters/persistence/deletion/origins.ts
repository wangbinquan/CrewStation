import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { BusinessContentOrigin } from '../../../domain/deletion/content';

export async function registerBusinessOrigin(db: Executor, origin: BusinessContentOrigin) {
  const [old] = await db.execute<{ id: string; project_id: string; identity: string }>(sql`SELECT id,project_id,identity FROM business_task.content_origins WHERE kind=${origin.kind} AND key=${origin.key}`);
  if (old) {
    if (old.id !== origin.id || old.project_id !== origin.projectId || old.identity !== origin.identity) throw precondition('业务内容的最小原归属不能替换');
    return;
  }
  await db.execute(sql`SELECT set_config('crewstation.business_task_origin',${jsonHash(origin)},true)`);
  await db.execute(sql`INSERT INTO business_task.content_origins(kind,key,id,project_id,identity) VALUES(${origin.kind},${origin.key},${origin.id},${origin.projectId},${origin.identity})`);
}
