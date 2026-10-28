import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { DatabaseMigrationOperation } from '../../domain/database-migration/operation';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { offlineInScope } from '../slotLifecycle';
import { hasWorkload } from '../../domain/slotLifecycle';
import { migrationContext } from './context';
import { migrationBindingInput, observeMigrationCandidate } from './activate';
import { assertMigrationJobsStopped, progressMigrationJob } from './jobs';
import { freezeForMigration } from './freeze';
export async function openMigration(deps:ReleaseUseCaseDeps,op:DatabaseMigrationOperation){
 const c=migrationContext(deps),handoff=await deps.uow.read.handoffs.get(op.id);
 if(handoff?.stage==='complete'){
  const binding=await c.database.active(op.serviceId,'production'),authority=await deps.executionHandoff!.inspect(op.serviceId);
  if(binding.generationId!==op.targetGenerationId||authority.stage!=='complete'||authority.targetReleaseId!==op.candidateReleaseId||authority.epoch<=op.freeze!.epoch||!await deps.executionHandoff!.observeRoute(op.serviceId,op.candidateReleaseId,op.targetSlot))throw conflict('数据库、执行权与路由尚未对账');
  return c.save(op,{stage:'completing'});
 }
 // Persist closure of the rollback window before creating a handoff that can grant writes.
 await c.database.openMigration!(op.serviceId,op.id);
 if(handoff)return op;
 const proof=await observeMigrationCandidate(deps,op);if(!proof)return op;
 if(!op.candidateProof||jsonHash(op.candidateProof)!==jsonHash(proof))throw conflict('确认后的候选物理证明变化');
 const now=deps.clock.now().toISOString();
 await deps.uow.run(async scope=>{await scope.slots.get(op.serviceId);if(!await scope.handoffs.get(op.id))await scope.handoffs.insert({id:op.id,requestKey:'database-migration:'+op.id,projectId:op.projectId,serviceId:op.serviceId,expectedActiveReleaseId:op.sourceReleaseId,targetReleaseId:op.candidateReleaseId,targetSlot:op.targetSlot,stage:'freezing',actorUserId:op.switchActor!.userId,reason:'数据库迁移 '+op.id,createdAt:now,updatedAt:now,revision:1,owner:null,leaseUntil:null});});
 return op;
}
async function retireCandidate(deps:ReleaseUseCaseDeps,op:DatabaseMigrationOperation){
 await deps.uow.run(async scope=>{
  const slots=await scope.slots.get(op.serviceId),slot=slots?.[op.targetSlot],now=deps.clock.now();
  if(slots&&slot&&slots.active!==op.targetSlot&&slot.releaseId===op.candidateReleaseId&&hasWorkload(slot))await offlineInScope(scope,slots,op.targetSlot,now,{reason:'manual',actorUserId:op.switchActor!.userId});
  const release=await scope.releases.getById(op.candidateReleaseId);if(release&&release.status!=='failed')await scope.releases.update({...release,status:'failed',updatedAt:now});
 });
 const service=await deps.services.resolveServiceById(op.serviceId);if(!service)throw precondition('原服务不可用');
 if(!await deps.deployer.removeWorkload(service.namespace,service.name,op.targetSlot,[op.candidateReleaseId]))throw precondition('等待迁移候选停止',{code:'restore_job_terminating'});
}
export async function finishMigration(deps:ReleaseUseCaseDeps,op:DatabaseMigrationOperation){
 const c=migrationContext(deps);
 if(op.stage==='completing'){
  if(!op.receipts.complete)return progressMigrationJob(deps,op,'database-migration-complete');
  await deps.maintenance.exitRestore!(op.switchActor!,op.serviceId,op.id,op.maintenanceRevision!);
  await c.database.finishMigration!(op.serviceId,op.id);return c.save(op,{stage:'completed',error:null,observation:null});
 }
 if(op.currentAttempt&&op.currentAttempt.purpose!=='database-migration-rollback'&&!['succeeded','failed'].includes(op.currentAttempt.proof?.receipt.state??'')){
  return progressMigrationJob(deps,op,op.currentAttempt.purpose,true);
 }
 await assertMigrationJobsStopped(deps,op);
 if(!op.abandonRequested){
  if(!op.freeze)return freezeForMigration(deps,op);
  if(!op.receipts.rollback)return progressMigrationJob(deps,op,'database-migration-rollback');
  const binding=await c.database.active(op.serviceId,'production');
  if(binding.generationId===op.targetGenerationId&&!op.rollbackRequest)throw conflict('AW 尚未请求绑定回退');
  await c.database.revertMigration!(migrationBindingInput(op));
 }
 await retireCandidate(deps,op);
 if(op.freeze||op.maintenanceRevision!==null)await deps.executionHandoff!.withdrawMigrationBarrier!(op.serviceId,op.id);
 if(op.maintenanceRevision!==null)await deps.maintenance.exitRestore!(op.switchActor!,op.serviceId,op.id,op.maintenanceRevision);
 const binding=await c.database.active(op.serviceId,'production');if(binding.migrationOperationId===op.id)await c.database.finishMigration!(op.serviceId,op.id);
 return c.save(op,{stage:op.abandonRequested?'abandoned':'rolled-back',error:null,observation:null});
}
