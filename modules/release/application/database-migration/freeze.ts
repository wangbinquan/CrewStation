import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { DatabaseMigrationOperation } from '../../domain/database-migration/operation';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { migrationContext } from './context';
export async function migrationBarrier(deps:ReleaseUseCaseDeps,op:DatabaseMigrationOperation){
 if(!await deps.maintenance.open(op.serviceId))throw precondition('迁移维护保留尚未生效');
 const result=await deps.executionHandoff!.migrationBarrier!(op.serviceId,{operationId:op.id,targetReleaseId:op.candidateReleaseId,expectedActiveReleaseId:op.sourceReleaseId});
 if(!result.ready||!result.preparationDigest||!await deps.executionHandoff!.observeWritersStopped!(op.serviceId))throw precondition(`等待旧写入者停止：${result.blocked.join('、')}`,{code:'restore_writers_running'});
 if(op.freeze&&op.freeze.epoch!==result.epoch)throw conflict('原迁移冻结 epoch 已变化');
 return result;
}
export async function freezeForMigration(deps:ReleaseUseCaseDeps,op:DatabaseMigrationOperation){
 const c=migrationContext(deps);if(!op.switchActor)throw precondition('迁移缺少管理员确认');await c.authorize(op.switchActor,op.serviceId);
 if(op.maintenanceRevision===null){const hold=await deps.maintenance.enterRestore!(op.switchActor,op.serviceId,op.id,'migration');return c.save(op,{maintenanceRevision:hold.revision});}
 const barrier=await migrationBarrier(deps,op);
 const digest=jsonHash({operationId:op.id,sourceReleaseId:op.sourceReleaseId,targetReleaseId:op.candidateReleaseId,sourceGenerationId:op.sourceGenerationId,epoch:barrier.epoch,preparationDigest:barrier.preparationDigest,maintenanceRevision:op.maintenanceRevision,writersStopped:true});
 return c.save(op,{freeze:{reference:`cs-freeze:${op.id}:${barrier.epoch}:${digest}`,epoch:barrier.epoch,digest},stage:op.stage==='rolling-back'?'rolling-back':'migrating'});
}
