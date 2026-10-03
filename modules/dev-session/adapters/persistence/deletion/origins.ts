import type { Executor } from '@crewstation/persistence';
import { jsonHash, precondition } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';
import type { DevelopmentContentOrigin } from '../../../domain/deletion/content';

/** A public original witness becomes a minimum immutable link, never a copied task or command body. */
export async function registerDevelopmentOrigin(db: Executor, origin: DevelopmentContentOrigin) {
  await db.execute(sql`SELECT set_config('crewstation.dev_session_origin',${jsonHash(origin)},true)`);
  await db.execute(sql`INSERT INTO dev_session.content_origins(kind,key,id,project_id,identity)
    VALUES(${origin.kind},${origin.key},${origin.id},${origin.projectId},${origin.identity}) ON CONFLICT DO NOTHING`);
  const rows = await db.execute<{ id: string; project_id: string; identity: string }>(sql`SELECT id,project_id,identity FROM dev_session.content_origins WHERE kind=${origin.kind} AND key=${origin.key}`);
  if (rows.length !== 1 || rows[0]!.id !== origin.id || rows[0]!.project_id !== origin.projectId || rows[0]!.identity !== origin.identity)
    throw precondition('开发内容的最小原归属不能替换');
}
