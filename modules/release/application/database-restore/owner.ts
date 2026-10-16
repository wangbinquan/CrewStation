import { timingSafeEqual } from 'node:crypto';
import { conflict, precondition } from '@crewstation/kernel';
import type { JobRef } from '../../api/moduleApi';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { restoreContext } from './context';
import { restoreEnvironment } from './jobs';
export async function databaseRestoreJobEnvironment(deps:ReleaseUseCaseDeps,ref:JobRef){
  const c=restoreContext(deps),op=await c.store.forJob(ref.releaseId);
  if(!op)throw precondition('原数据库恢复 Job 不存在');
  const restore=ref.purpose==='database-restore';
  if(ref.releaseId!==(restore?op.restoreJobId:op.verifyJobId)||op.stage!==(restore?'restoring':'verifying')||op.error)throw conflict('原恢复已经不在这个 Job 阶段');
  const record=await deps.uow.read.ledger!.jobRecord(ref.releaseId,'migration-job');
  if(!record||record.id!==ref.recordId)throw conflict('恢复 Job 资源身份不一致');
  return restoreEnvironment(deps,op,restore?'database-restore':'database-verify');
}
export function restoreObjectSource(deps:ReleaseUseCaseDeps){
  return async(jobId:string,token:string)=>{
    if(!deps.databaseRestore||!deps.uow.read.databaseRestores||!token||token.length>256)return undefined;
    const op=await deps.uow.read.databaseRestores.forJob(jobId);if(!op||op.error||!['restoring','verifying'].includes(op.stage))return undefined;
    if(jobId!==(op.stage==='restoring'?op.restoreJobId:op.verifyJobId))return undefined;
    const expected=Buffer.from(deps.databaseRestore.token(jobId,op.requestDigest)),actual=Buffer.from(token);
    if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return undefined;
    const service=await deps.services.resolveServiceById(op.serviceId);
    if(!service||service.projectId!==op.projectId||op.manifest.kind!=='DigitalWorker'||!op.manifest.spec.data?.objects.planId)return undefined;
    return {projectId:op.projectId,serviceId:op.serviceId,env:'production' as const,fenced:false as const,writeAllowed:false as const,planId:op.manifest.spec.data.objects.planId};
  };
}
