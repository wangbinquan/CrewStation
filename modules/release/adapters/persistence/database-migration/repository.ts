import { createHash } from 'node:crypto';
import { conflict, validation } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { DatabaseMigrationOperation } from '../../../domain/database-migration/operation';
import { migrationDto } from '../../../domain/database-migration/operation';
import { assertMigrationTransition } from '../../../domain/database-migration/transitions';
import type { DatabaseMigrationRepository } from '../../../ports/databaseMigration';
const open=sql`stage NOT IN ('completed','rolled-back','abandoned')`;
export function databaseMigrationRepository(db:Executor):DatabaseMigrationRepository {
 const many=async(query:ReturnType<typeof sql>)=>(await db.execute<{body:DatabaseMigrationOperation}>(query)).map(row=>{migrationDto(row.body);return row.body;});
 const one=async(query:ReturnType<typeof sql>)=>(await many(query))[0];
 return {
  get:id=>one(sql`SELECT body FROM release.database_migrations WHERE id=${id}`),
  forJob:id=>one(sql`SELECT body FROM release.database_migrations WHERE body->'currentAttempt'->>'jobId'=${id}`),
  active:serviceId=>one(sql`SELECT body FROM release.database_migrations WHERE service_id=${serviceId} AND ${open}`),
  list:serviceId=>many(sql`SELECT body FROM release.database_migrations WHERE service_id=${serviceId} ORDER BY created_at DESC,id LIMIT 100`),
  pending:(limit,afterId)=>many(sql`SELECT body FROM release.database_migrations WHERE ${open} AND (body->>'error' IS NULL OR body->>'abandonRequested'='true') ${afterId?sql`AND id>${afterId}`:sql``} ORDER BY id LIMIT ${limit}`),
  insert:async op=>{await db.execute(sql`INSERT INTO release.database_migrations(id,project_id,service_id,stage,revision,body,created_at,updated_at) VALUES(${op.id},${op.projectId},${op.serviceId},${op.stage},${op.revision},${JSON.stringify(op)}::jsonb,${op.createdAt},${op.updatedAt})`);},
  save:async(original,next)=>{
   assertMigrationTransition(original.stage,next.stage,original);
   if(next.revision!==original.revision+1||next.id!==original.id)throw conflict('迁移 revision 不合法',{code:'stale_revision'});
   const result=await db.execute(sql`UPDATE release.database_migrations SET body=${JSON.stringify(next)}::jsonb,stage=${next.stage},revision=${next.revision},updated_at=${next.updatedAt} WHERE id=${original.id} AND revision=${original.revision} RETURNING id`);
   if(result.length!==1)throw conflict('迁移操作已变化',{code:'stale_revision'});
  },
  artifact:async(id,name)=>{const row=(await db.execute<{encoded:string;digest:string}>(sql`SELECT encode(bytes,'base64') AS encoded,digest FROM release.database_migration_artifacts WHERE operation_id=${id} AND name=${name}`))[0];return row?{bytes:row.encoded.replaceAll('\n',''),digest:row.digest}:null;},
  writeArtifact:async(id,name,digest,encoded)=>{
   const bytes=Buffer.from(encoded,'base64');if('sha256:'+createHash('sha256').update(bytes).digest('hex')!==digest)throw validation('产物摘要不一致',{code:'database_migration_receipt_mismatch'});
   await db.execute(sql`INSERT INTO release.database_migration_artifacts(operation_id,project_id,name,digest,size,bytes) SELECT id,project_id,${name},${digest},${bytes.length},decode(${encoded},'base64') FROM release.database_migrations WHERE id=${id} ON CONFLICT(operation_id,name) DO NOTHING`);
   const row=(await db.execute<{digest:string;size:number;equal:boolean}>(sql`SELECT digest,size,bytes=decode(${encoded},'base64') AS equal FROM release.database_migration_artifacts WHERE operation_id=${id} AND name=${name}`))[0];
   if(!row||row.digest!==digest||!row.equal)throw conflict('同名迁移产物不能覆盖',{code:'write-once-conflict'});
   return {digest:row.digest,bytes:Number(row.size)};
  },
 };
}
