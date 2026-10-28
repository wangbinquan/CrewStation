import type { Actor, CreateDatabaseMigration, ServiceId } from '@crewstation/contracts';
import { ReleaseIdSchema } from '@crewstation/contracts';
import { conflict, jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { DatabaseMigrationOperation } from '../../domain/database-migration/operation';
import { migrationDto } from '../../domain/database-migration/operation';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { migrationContext } from './context';
function nextTag(tags:string[],id:string){
 const versions=tags.flatMap(tag=>{const m=/^v?(\d+)\.(\d+)\.(\d+)/.exec(tag);return m?[[Number(m[1]),Number(m[2]),Number(m[3])]]:[];}).sort((a,b)=>b[0]!-a[0]!||b[1]!-a[1]!||b[2]!-a[2]!);
 const v=versions[0]??[0,0,0];return `v${v[0]}.${v[1]}.${v[2]!+1}+migrate.${id.replaceAll('-','')}`;
}
export async function createDatabaseMigration(deps:ReleaseUseCaseDeps,actor:Actor,serviceId:ServiceId,input:CreateDatabaseMigration){
 const c=migrationContext(deps),service=await c.authorize(actor,serviceId),requestDigest=jsonHash({serviceId,actor:actor.userId,input});
 return c.work(serviceId,input.requestId,{requestDigest},async()=>{
  const existing=await c.store.get(input.requestId);if(existing){if(existing.serviceId!==serviceId||existing.requestDigest!==requestDigest)throw conflict('迁移请求 ID 已用于不同输入');return migrationDto(existing);}
  await c.support.coordination.assertAvailable(serviceId);
  const binding=await c.database.active(serviceId,'production'),source=await deps.uow.read.releases.getById(input.expectedActiveReleaseId);
  if(binding.generationId!==input.expectedActiveGenerationId||binding.restoreOperationId||binding.migrationOperationId)throw conflict('生产数据库绑定已变化或被预留');
  if(!source||source.serviceId!==serviceId||source.manifest?.kind!=='DigitalWorker'||source.manifest.spec.tasks?.executionControl!=='fenced')throw precondition('原版本必须支持 fenced 执行冻结');
  if(!deps.executionHandoff?.migrationBarrier||!deps.executionHandoff.observeWritersStopped||!deps.executionHandoff.withdrawMigrationBarrier||!deps.maintenance.enterRestore||!deps.maintenance.exitRestore)throw precondition('迁移停写与维护端口未配置');
  const candidateTag=nextTag((await deps.uow.read.releases.listByService(serviceId,100)).map(r=>r.tag),input.requestId);
  const op=await deps.uow.run(async scope=>{
   const slots=await scope.slots.get(serviceId);if(!slots||slots[slots.active].releaseId!==source.id||slots[slots.active].state!=='ready')throw conflict('当前正式版本已变化');
   await c.support.coordination.assertAvailable(serviceId);
   if(await scope.releases.findInProgress(serviceId)||await scope.handoffs.active(serviceId)||await scope.maintenance.active(serviceId))throw conflict('服务已有未结束发布、运维或交接');
   const now=deps.clock.now().toISOString();
   const value:DatabaseMigrationOperation={id:input.requestId,projectId:service.projectId,serviceId,revision:1,stage:'requested',requestDigest,sourceBindingRevision:binding.revision,sourceGenerationId:binding.generationId,targetGenerationId:newResourceId(),scratchGenerationId:newResourceId(),sourceReleaseId:source.id,candidateReleaseId:ReleaseIdSchema.parse(newResourceId()),targetSlot:slots.active==='blue'?'green':'blue',branch:input.branch,commitSha:input.expectedCommitSha,candidateTag,image:null,manifest:null,plan:null,approval:null,environmentBox:null,environmentVersion:null,currentAttempt:null,previousAttempts:[],prepared:null,rollbackRequest:null,freeze:null,switchActor:null,maintenanceRevision:null,candidateProof:null,receipts:{},error:null,observation:null,abandonRequested:false,createdBy:actor.userId,createdAt:now,updatedAt:now};
   await scope.databaseMigrations!.insert(value);
   const active=slots[slots.active];if(active.workload)await scope.slots.save({...slots,[slots.active]:{...active,workload:{...active.workload,databaseGenerationId:binding.generationId}}});
   return value;
  });
  return migrationDto(op);
 });
}
