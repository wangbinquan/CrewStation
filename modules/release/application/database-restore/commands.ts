import type { Actor, CreateDatabaseRestore, RetryDatabaseRestore, ServiceId, SwitchDatabaseRestore } from '@crewstation/contracts';
import { ReleaseIdSchema } from '@crewstation/contracts';
import { conflict, jsonHash, newResourceId, notFound, precondition } from '@crewstation/kernel';
import { createHash } from 'node:crypto';
import type { DatabaseRestoreOperation } from '../../domain/databaseRestore';
import { restoreConfirmation, restoreDto } from '../../domain/databaseRestore';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { restoreContext } from './context';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export function databaseRestoreCommands(deps:ReleaseUseCaseDeps){
  return {
    listDatabaseRestores:async(actor:Actor,serviceId:ServiceId)=>{const c=restoreContext(deps);await c.authorize(actor,serviceId,false);const manage=actor.isAdmin&&await c.support.isAdmin(actor.userId);return {items:(await c.store.list(serviceId)).map(op=>({...restoreDto(op),...(!manage?{actions:[]}: {})}))};},
    databaseGenerations:async(actor:Actor,serviceId:ServiceId)=>{const c=restoreContext(deps);await c.authorize(actor,serviceId,false);return c.database.list(actor,serviceId);},
    getDatabaseRestore:async(actor:Actor,serviceId:ServiceId,id:string)=>{const c=restoreContext(deps);await c.authorize(actor,serviceId,false);const op=restoreDto(await c.load(serviceId,id));return actor.isAdmin&&await c.support.isAdmin(actor.userId)?op:{...op,actions:[]};},
    createDatabaseRestore:async(actor:Actor,serviceId:ServiceId,input:CreateDatabaseRestore)=>{
      const c=restoreContext(deps),service=await c.authorize(actor,serviceId),requestDigest=jsonHash({serviceId,actor:actor.userId,input});
      return c.work(serviceId,input.requestId,{requestDigest},async()=>{
        const existing=await c.store.get(input.requestId);
        if(existing){if(existing.serviceId!==serviceId||existing.requestDigest!==requestDigest)throw conflict('恢复请求 ID 已用于不同输入');return restoreDto(existing);}
        const [source,restore,binding]=await Promise.all([deps.uow.read.releases.getById(input.expectedActiveReleaseId),deps.uow.read.releases.getById(input.restoreReleaseId),c.database.active(serviceId,'production')]);
        if(!source||source.serviceId!==serviceId||!restore||restore.serviceId!==serviceId)throw notFound('原服务发布');
        if(binding.generationId!==input.expectedActiveGenerationId||binding.restoreOperationId)throw conflict('生产数据库绑定已变化或已被保留');
        if([source,restore].some(release=>release.manifest?.spec.env.some(entry=>['CS_DATABASE_URL','CS_DATABASE_GENERATION_ID','CS_DATABASE_GENERATION_OPERATION'].includes(entry.name))))throw precondition('恢复版本不能声明平台数据库连接或世代变量');
        if(!restore.image||!restore.pipeline.readyAt||!restore.manifest?.spec.service.databaseRestore)throw precondition('恢复版本必须已就绪并声明固定恢复与校验命令');
        if(source.manifest?.kind!=='DigitalWorker'||source.manifest.spec.tasks?.executionControl!=='fenced'||restore.manifest.kind!=='DigitalWorker'||restore.manifest.spec.tasks?.executionControl!=='fenced')throw precondition('数据库恢复切换要求原版本和目标版本支持 fenced 停写与执行交接');
        if(!deps.executionHandoff?.migrationBarrier||!deps.executionHandoff.observeWritersStopped||!deps.maintenance.enterRestore||!deps.maintenance.exitRestore)throw precondition('恢复停写、独立观察或维护保留端口未配置');
        const image=/@sha256:[a-f0-9]{64}$/.test(restore.image)?restore.image:await deps.runtimeImages?.pinBuiltImage?.(service.slug,restore.image);
        if(!image||!/@sha256:[a-f0-9]{64}$/.test(image))throw precondition('恢复镜像无法固定到不可变摘要');
        return deps.uow.run(async scope=>{
          const slots=await scope.slots.get(serviceId);
          if(!slots||slots[slots.active].releaseId!==source.id||slots[slots.active].state!=='ready')throw conflict('当前正式版本已变化');
          if(await scope.releases.findInProgress(serviceId)||await scope.handoffs.active(serviceId))throw conflict('服务已有未结束发布或执行交接');
          const targetSlot=slots.active==='blue'?'green':'blue',now=deps.clock.now().toISOString();
          const op:DatabaseRestoreOperation={id:input.requestId,projectId:service.projectId,serviceId,revision:1,stage:'requested',sourceGenerationId:binding.generationId,targetGenerationId:newResourceId(),sourceBindingRevision:binding.revision,
            sourceReleaseId:source.id,restoreReleaseId:restore.id,candidateReleaseId:ReleaseIdSchema.parse(newResourceId()),targetSlot,image,manifest:restore.manifest!,sourceTag:restore.tag,sourceCommit:restore.commitSha,sourceBranch:restore.branch,
            executionMaterials:restore.pipeline.executionMaterials,...(restore.pipeline.runtimeImage?{runtimeImage:restore.pipeline.runtimeImage}:{}),backupReference:input.backupReference,backupReferenceDigest:digest(input.backupReference),requestDigest,
            previousAttempts:[],candidateProof:null,environmentBox:null,environmentVersion:null,restoreJobId:newResourceId(),verifyJobId:newResourceId(),restoreProof:null,verifyProof:null,restoreJob:null,verifyJob:null,verification:null,switchActor:null,maintenanceRevision:null,maintenanceWasOpen:null,error:null,createdBy:actor.userId,createdAt:now,updatedAt:now};
          await scope.databaseRestores!.insert(op);
          const current=slots[slots.active];
          if(current.workload)await scope.slots.save({...slots,[slots.active]:{...current,workload:{...current.workload,databaseGenerationId:binding.generationId}}});
          return restoreDto(op);
        });
      });
    },
    retryDatabaseRestore:async(actor:Actor,serviceId:ServiceId,id:string,input:RetryDatabaseRestore)=>{
      const c=restoreContext(deps);await c.authorize(actor,serviceId);
      return c.work(serviceId,id,{retry:input},async()=>{const op=await c.load(serviceId,id);if(op.revision!==input.expectedRevision)throw conflict('恢复操作已变化');if(op.stage==='completed')return restoreDto(op);
        const failed=op.stage==='restoring'?op.restoreProof:op.stage==='verifying'?op.verifyProof:null;
        if(failed?.receipt.state==='failed'){
          // Only an observed terminal failure authorizes another attempt. Unknown
          // submissions keep their original Job ID and are reconciled in place.
          await c.database.envFor(serviceId,op.targetGenerationId,op.id);
          const restoring=op.stage==='restoring',jobId=restoring?op.restoreJobId:op.verifyJobId;
          await deps.uow.run(scope=>scope.ledger!.restoreJobObserved(jobId));
          return restoreDto(await c.save(op,{error:null,previousAttempts:[...op.previousAttempts,{jobId,purpose:restoring?'database-restore':'database-verify',proof:failed}],
            ...(restoring?{restoreJobId:newResourceId(),restoreProof:null,restoreJob:null}:{verifyJobId:newResourceId(),verifyProof:null,verifyJob:null,verification:null})}));
        }
        // Re-send durable terminal observations after a lost cleanup response,
        // including an operation already awaiting the administrator's switch.
        for(const [jobId,proof] of [[op.restoreJobId,op.restoreProof],[op.verifyJobId,op.verifyProof]] as const)if(proof&&['succeeded','failed'].includes(proof.receipt.state))await deps.uow.run(scope=>scope.ledger!.restoreJobObserved(jobId));
        return restoreDto(op.error?await c.save(op,{error:null}):op);});
    },
    switchDatabaseRestore:async(actor:Actor,serviceId:ServiceId,id:string,input:SwitchDatabaseRestore)=>{
      const c=restoreContext(deps);await c.authorize(actor,serviceId);
      return c.work(serviceId,id,{switch:input,actor:actor.userId},async()=>{
        const op=await c.load(serviceId,id);
        if(op.revision!==input.expectedRevision||restoreConfirmation(op)!==input.confirmationDigest)throw conflict('恢复目标或确认内容已变化，请重新核对');
        const [slots,binding]=await Promise.all([deps.uow.read.slots.get(serviceId),c.database.active(serviceId,'production')]);
        if(!slots||slots[slots.active].releaseId!==op.sourceReleaseId||binding.generationId!==op.sourceGenerationId||binding.revision!==op.sourceBindingRevision||binding.restoreOperationId!==op.id)throw conflict('原生产版本或数据库绑定已变化');
        await c.database.envFor(serviceId,op.targetGenerationId,op.id);
        return restoreDto(await c.save(op,{stage:'freezing',switchActor:actor}));
      });
    },
  };
}
