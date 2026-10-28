import { timingSafeEqual } from 'node:crypto';
import type { Actor } from '@crewstation/contracts';
import { conflict, isPlatformError, precondition } from '@crewstation/kernel';
import type { JobRef, ReleaseModuleApi } from '../../api/moduleApi';
import type { DatabaseRestoreOperation } from '../../domain/databaseRestore';
import { advance, isInProgress } from '../../domain/release';
import { hasWorkload } from '../../domain/slotLifecycle';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { offlineInScope } from '../slotLifecycle';
import { restoreContext } from './context';
import { restoreEnvironment } from './jobs';
export async function databaseRestoreJobEnvironment(deps:ReleaseUseCaseDeps,ref:JobRef){
  const c=restoreContext(deps),op=await c.store.forJob(ref.releaseId);
  if(!op)throw precondition('原数据库恢复 Job 不存在');
  const restore=ref.purpose==='database-restore';
  if(ref.releaseId!==(restore?op.restoreJobId:op.verifyJobId)||op.stage!==(restore?'restoring':'verifying')||op.error||op.abandonedAt)throw conflict('原恢复已经不在这个 Job 阶段');
  const record=await deps.uow.read.ledger!.jobRecord(ref.releaseId,'migration-job');
  if(!record||record.id!==ref.recordId)throw conflict('恢复 Job 资源身份不一致');
  return restoreEnvironment(deps,op,restore?'database-restore':'database-verify');
}
export function restoreObjectSource(deps:ReleaseUseCaseDeps){
  return async(jobId:string,token:string)=>{
    if(!deps.databaseRestore||!deps.uow.read.databaseRestores||!token||token.length>256)return undefined;
    const op=await deps.uow.read.databaseRestores.forJob(jobId);if(!op||op.error||op.abandonedAt||!['restoring','verifying'].includes(op.stage))return undefined;
    if(jobId!==(op.stage==='restoring'?op.restoreJobId:op.verifyJobId))return undefined;
    const expected=Buffer.from(deps.databaseRestore.token(jobId,op.requestDigest)),actual=Buffer.from(token);
    if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return undefined;
    const service=await deps.services.resolveServiceById(op.serviceId);
    if(!service||service.projectId!==op.projectId||op.manifest.kind!=='DigitalWorker'||!op.manifest.spec.data?.objects.planId)return undefined;
    return {projectId:op.projectId,serviceId:op.serviceId,env:'production' as const,fenced:false as const,writeAllowed:false as const,planId:op.manifest.spec.data.objects.planId};
  };
}
/** A deployed but never-switched candidate leaves the reserved slot and can no longer block later releases. */
async function retireCandidate(deps:ReleaseUseCaseDeps,op:DatabaseRestoreOperation,actor:Actor){
  await deps.uow.run(async scope=>{
    const slots=await scope.slots.get(op.serviceId),slot=slots?.[op.targetSlot],now=deps.clock.now();
    if(slots&&slot&&slots.active!==op.targetSlot&&slot.releaseId===op.candidateReleaseId&&hasWorkload(slot))await offlineInScope(scope,slots,op.targetSlot,now,{reason:'manual',actorUserId:actor.userId});
    const release=await scope.releases.getById(op.candidateReleaseId);
    if(release&&isInProgress(release))await scope.releases.update(advance(release,'failed',now));
  });
}
/**
 * RFC-042 abandon: release every reservation and hold of a never-switched restore. Each step is idempotent, so an interrupted
 * abandon is finished by repeating it; the target database is retained for inspection and never deleted here.
 */
export async function releaseRestoreHolds(deps:ReleaseUseCaseDeps,op:DatabaseRestoreOperation,actor:Actor){
  const c=restoreContext(deps);
  try{await c.database.abandon(op.serviceId,op.id);}
  catch(error){
    // The binding commit raced ahead of the switch record: continue forward instead of staying half-abandoned.
    if(isPlatformError(error)&&error.details['code']==='database_restore_switched')await c.save(op,{abandonedBy:null,abandonedAt:null,switchCommitted:true});
    throw error;
  }
  await retireCandidate(deps,op,actor);
  await deps.executionHandoff!.withdrawMigrationBarrier!(op.serviceId,op.id);
  if(op.maintenanceRevision!==null)await deps.maintenance.exitRestore!(actor,op.serviceId,op.id,op.maintenanceRevision);
  for(const jobId of new Set([op.restoreJobId,op.verifyJobId,...op.previousAttempts.map(attempt=>attempt.jobId)]))await deps.uow.run(scope=>scope.ledger!.restoreJobObserved(jobId));
}
/**
 * Operations that would change the slots or releases an unfinished restore reserves get one documented precheck
 * (`database_restore_active`), with or without project admission wiring; triggers no longer turn this into HTTP 500.
 */
export function restoreGuardedReleaseApi(deps:ReleaseUseCaseDeps,api:ReleaseModuleApi):ReleaseModuleApi{
  const coordination=deps.databaseRestore?.coordination??deps.databaseMigration?.coordination;if(!coordination)return api;
  return {...api,
    publish:async(actor,id,input,source)=>{await coordination.assertAvailable(id);return api.publish(actor,id,input,source);},
    takeOffline:async(actor,id,input)=>{await coordination.assertAvailable(id);return api.takeOffline(actor,id,input);},
    postponeOffline:async(actor,id,input)=>{await coordination.assertAvailable(id);return api.postponeOffline(actor,id,input);},
    redeploy:async(actor,id,input)=>{const release=await deps.uow.read.releases.getById(id);if(release)await coordination.assertAvailable(release.serviceId);return api.redeploy(actor,id,input);},
  };
}
