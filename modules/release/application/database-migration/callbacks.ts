import { timingSafeEqual } from 'node:crypto';
import { MigrationActivationQuerySchema, MigrationArtifactQuerySchema, MigrationArtifactWriteSchema, MigrationBackupQuerySchema, MigrationFreezeVerifySchema, MigrationPreparedSchema, MigrationRollbackSchema, DatabaseMigrationReceiptSchema } from '@crewstation/contracts';
import { conflict, forbidden, jsonHash, notFound, PlatformError } from '@crewstation/kernel';
import type { DatabaseMigrationOperation } from '../../domain/database-migration/operation';
import { migrationJobPurpose, migrationOperationKey } from '../../domain/database-migration/operation';
import { migrationCanonical, migrationDigest } from '../../domain/database-migration/evidence';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { migrationContext } from './context';
import { migrationBarrier } from './freeze';
export interface MigrationCallback { jobId:string; token:string; operationId:string; method:'GET'|'POST'; action:string; input:unknown }
export async function migrationJobIdentity(deps:ReleaseUseCaseDeps,jobId:string,token:string){
 if(!deps.databaseMigration||!token||token.length>256)return undefined;
 const op=await deps.uow.read.databaseMigrations?.forJob(jobId);
 if(!op||op.error||op.abandonRequested||op.currentAttempt?.purpose!==migrationJobPurpose(op.stage))return undefined;
 const expected=Buffer.from(deps.databaseMigration.token(jobId,op.requestDigest)),actual=Buffer.from(token);
 return actual.length===expected.length&&timingSafeEqual(actual,expected)?op:undefined;
}
export async function databaseMigrationCallback(deps:ReleaseUseCaseDeps,request:MigrationCallback){
 const c=migrationContext(deps),initial=await migrationJobIdentity(deps,request.jobId,request.token);
 if(!initial||request.operationId!==migrationOperationKey(initial.id))throw forbidden('迁移 Job 或操作已变化');
 return c.work(initial.serviceId,initial.id,{callback:request.action,jobId:request.jobId},async()=>{
  const op=await migrationJobIdentity(deps,request.jobId,request.token);if(!op)throw forbidden('迁移 Job 已结束');
  const same=(id:string)=>{if(id!==request.operationId)throw conflict('回调操作 ID 不匹配');};
  if(request.action==='artifacts'){
   if(request.method==='GET'){const input=MigrationArtifactQuerySchema.parse(request.input);same(input.operationId);return c.store.artifact(op.id,input.name);}
   const input=MigrationArtifactWriteSchema.parse(request.input);same(input.operationId);return c.store.writeArtifact(op.id,input.name,input.digest,input.bytes);
  }
  if(request.action==='activation'&&request.method==='GET'){
   const input=MigrationActivationQuerySchema.parse(request.input);same(input.operationId);
   const binding=await c.database.active(op.serviceId,'production');
   return {pointsAt:binding.generationId===op.sourceGenerationId?'source':binding.generationId===op.targetGenerationId?'target':binding.generationId?'other':'none',pointerDigest:binding.generationId?migrationDigest({generationId:binding.generationId,revision:binding.revision}):null};
  }
  if(request.action==='backup'&&request.method==='GET'){MigrationBackupQuerySchema.parse(request.input);throw new PlatformError('not_found','旧 epoch 备份恢复尚不支持',{code:'database_migration_restore_unsupported'});}
  if(request.action==='freeze/verify'&&request.method==='POST'){
   const input=MigrationFreezeVerifySchema.parse(request.input);same(input.operationId);
   if(!['migrating','rolling-back'].includes(op.stage))throw forbidden('此 Job 不使用冻结验证');
   if(!op.freeze||input.reference!==op.freeze.reference||input.sourceGenerationId!==op.sourceGenerationId||!input.writersStopped)return {verified:false};
   try{await migrationBarrier(deps,op);return {verified:true};}catch(error){if(error instanceof PlatformError&&['precondition','conflict'].includes(error.kind))return {verified:false};throw error;}
  }
  if(request.action==='prepared'&&request.method==='POST')return prepareActivation(deps,op,request.input);
  if(request.action==='rollback'&&request.method==='POST'){
   const input=MigrationRollbackSchema.parse(request.input);
   if(op.stage!=='rolling-back'||input.requestKey!==request.operationId+':rollback')throw conflict('回退请求不属于当前尝试');
   if(op.rollbackRequest&&op.rollbackRequest!==input.requestKey)throw conflict('回退请求键已变化');
   if(!op.rollbackRequest)await c.save(op,{rollbackRequest:input.requestKey});return {};
  }
  throw notFound('迁移回调',request.action);
 });
}
async function prepareActivation(deps:ReleaseUseCaseDeps,op:DatabaseMigrationOperation,raw:unknown){
 const c=migrationContext(deps),input=MigrationPreparedSchema.parse(raw);
 if(op.stage!=='migrating'||input.operationId!==migrationOperationKey(op.id)||input.generationId!==op.plan?.plan.payload.target.generationId||input.requestKey!==input.operationId+':'+input.receiptDigest)throw conflict('激活准备不属于当前迁移');
 if(op.prepared){if(jsonHash(op.prepared)!==jsonHash(input))throw conflict('激活准备不可覆盖',{code:'write-once-conflict'});return {};}
 const artifact=await c.store.artifact(op.id,'activation-receipt.json');if(!artifact)throw conflict('激活回执尚未保存');
 const receipt=DatabaseMigrationReceiptSchema.parse(JSON.parse(Buffer.from(artifact.bytes,'base64').toString()));
 const target=receipt.payload['target'] as {generationId?:string;location?:unknown}|undefined;
 if(receipt.digest!==input.receiptDigest||migrationDigest(receipt.payload)!==input.receiptDigest||receipt.payload.operationId!==input.operationId||target?.generationId!==input.generationId||migrationCanonical(target?.location)!==migrationCanonical(input.location))throw conflict('激活准备摘要或目标不一致',{code:'database_migration_receipt_mismatch'});
 await c.save(op,{prepared:input});return {};
}
