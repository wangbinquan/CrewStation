import type { ServiceId } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { keyedLock } from '@crewstation/persistence';
import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import type { DatabaseRestoreOperation } from '../../domain/databaseRestore';
import { restoreDto } from '../../domain/databaseRestore';
import type { DatabaseRestoreCoordination, DatabaseRestoreRepository } from '../../ports/databaseRestore';
const current = new AsyncLocalStorage<{ db: Database; id: string; active: boolean }>();
const decode = (row: { body: DatabaseRestoreOperation; revision: number; stage: DatabaseRestoreOperation['stage'] } | undefined) => {
  if (!row) return; const op = { ...row.body, revision: row.revision, stage: row.stage }; restoreDto(op); return op;
};
/** Unfinished operations: completed and abandoned ones no longer reserve the service. */
const open = sql`stage NOT IN ('completed','abandoned')`;
export function databaseRestoreRepository(db: Executor): DatabaseRestoreRepository {
  const one = async (query: ReturnType<typeof sql>) => decode((await db.execute<{ body: DatabaseRestoreOperation; revision: number; stage: DatabaseRestoreOperation['stage'] }>(query))[0]);
  const many = async (query: ReturnType<typeof sql>) => (await db.execute<{ body: DatabaseRestoreOperation; revision: number; stage: DatabaseRestoreOperation['stage'] }>(query)).map(row => decode(row)!);
  return {
    get: id => one(sql`SELECT body,revision,stage FROM release.database_restores WHERE id=${id}`),
    forJob: id => one(sql`SELECT body,revision,stage FROM release.database_restores WHERE body->>'restoreJobId'=${id} OR body->>'verifyJobId'=${id}`),
    active: serviceId => one(sql`SELECT body,revision,stage FROM release.database_restores WHERE service_id=${serviceId} AND ${open}`),
    list: serviceId => many(sql`SELECT body,revision,stage FROM release.database_restores WHERE service_id=${serviceId} ORDER BY created_at DESC,id LIMIT 100`),
    pending: (limit, afterId) => many(sql`SELECT body,revision,stage FROM release.database_restores WHERE ${open} AND stage<>'ready-to-switch' AND body->>'error' IS NULL AND body->>'abandonedAt' IS NULL ${afterId ? sql`AND id>${afterId}` : sql``} ORDER BY id LIMIT ${limit}`),
    insert: async op => { await db.execute(sql`INSERT INTO release.database_restores(id,project_id,service_id,stage,revision,body,created_at,updated_at) VALUES(${op.id},${op.projectId},${op.serviceId},${op.stage},${op.revision},${JSON.stringify(op)}::jsonb,${op.createdAt},${op.updatedAt})`); },
    save: async (original,next) => {
      if (next.revision !== original.revision + 1 || next.id !== original.id) throw conflict('恢复 revision 不合法');
      const rows=await db.execute(sql`UPDATE release.database_restores SET stage=${next.stage},revision=${next.revision},body=${JSON.stringify(next)}::jsonb,updated_at=${next.updatedAt} WHERE id=${original.id} AND revision=${original.revision} RETURNING id`);
      if(rows.length!==1)throw conflict('恢复操作已变化，请刷新后重试');
    },
  };
}
export function databaseRestoreCoordination(db: Database): DatabaseRestoreCoordination {
  const lock=keyedLock(db);
  return { run: (id,effect) => {const prior=current.getStore();if(prior?.db===db&&prior.active&&prior.id===id)return effect();return lock(['release.database-restore:'+id],async()=>{
    const scope={db,id,active:true};
    try{return await current.run(scope,effect);}finally{scope.active=false;}
  });}, assertAvailable: async(serviceId: ServiceId,operationId?:string)=>{
    const [row]=await db.execute<{id:string}>(sql`SELECT id FROM release.database_restores WHERE service_id=${serviceId} AND ${open}`);
    if(row&&row.id!==operationId)throw conflict('服务正在进行数据库恢复，请先完成或放弃原恢复操作',{code:'database_restore_active',operationId:row.id});
  } };
}
