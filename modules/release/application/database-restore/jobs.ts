import type { DatabaseRestoreOperation } from '../../domain/databaseRestore';
import { restoreJobName, retainJobProof } from '../../domain/databaseRestore';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { renderSlotEnv } from '../pipelineEnv';
import { restoreContext } from './context';
export async function restoreEnvironment(deps:ReleaseUseCaseDeps,op:DatabaseRestoreOperation,purpose?:'database-restore'|'database-verify'){
  const c=restoreContext(deps);if(!op.environmentBox)throw precondition('原恢复环境尚未冻结');
  const environment:unknown=JSON.parse(await c.support.decrypt(op.environmentBox));
  if(!environment||typeof environment!=='object'||Array.isArray(environment)||Object.values(environment).some(v=>typeof v!=='string'))throw precondition('原恢复环境不可读取');
  const values={...environment as Record<string,string>};
  const target=await c.database.envFor(op.serviceId,op.targetGenerationId,op.id);
  if(values.CS_DATABASE_URL!==target.CS_DATABASE_URL)throw conflict('原恢复目标凭据已变化');
  if(purpose){
    const jobId=purpose==='database-restore'?op.restoreJobId:op.verifyJobId;
    return {...values,CS_DATABASE_RESTORE_REFERENCE:op.backupReference,CS_DATABASE_RESTORE_OPERATION:op.id,
      CS_OBJECTS_URL:c.support.objectReadUrl.replace(/\/$/,'')+'/'+jobId,CS_OBJECTS_TOKEN:c.support.token(jobId,op.requestDigest)};
  }
  return values;
}
export async function freezeRestoreEnvironment(deps:ReleaseUseCaseDeps,op:DatabaseRestoreOperation){
  if(op.environmentBox)return op;
  const c=restoreContext(deps),service=await deps.services.resolveServiceById(op.serviceId);if(!service)throw precondition('原服务已不可用');
  const env=await renderSlotEnv(deps,{projectId:op.projectId,serviceId:op.serviceId,projectSlug:service.slug,serviceName:service.name,physical:op.targetSlot,manifest:op.manifest,databaseGeneration:{id:op.targetGenerationId,operationId:op.id}});
  return c.save(op,{environmentBox:await c.support.encrypt(JSON.stringify(env.values)),environmentVersion:env.configVersion});
}
export async function progressRestoreJob(deps:ReleaseUseCaseDeps,op:DatabaseRestoreOperation,purpose:'database-restore'|'database-verify'){
  const c=restoreContext(deps),service=await deps.services.resolveServiceById(op.serviceId);if(!service)throw precondition('原服务已不可用');
  const jobId=purpose==='database-restore'?op.restoreJobId:op.verifyJobId,proof=purpose==='database-restore'?op.restoreProof:op.verifyProof;
  const name=restoreJobName(jobId,purpose),command=purpose==='database-restore'?op.manifest.spec.service.databaseRestore!.command:op.manifest.spec.service.databaseRestore!.verifyCommand;
  const target=await c.database.prepare(op.serviceId,op.id,op.targetGenerationId);
  if(!target.ready||!target.identity)throw precondition('原目标数据库身份或凭据尚不可确认');
  const environment=await restoreEnvironment(deps,op,purpose);
  const observed=await c.support.jobs.observe({namespace:service.namespace,name,jobId,purpose,image:op.image,command,target:target.identity,environment,previous:proof});
  if(!observed){
    const record=await deps.uow.read.ledger!.jobRecord(jobId,'migration-job');
    if(record?.conditions.some(c=>c.type==='Created'&&c.status==='true'))throw conflict('原恢复 Job 已创建但当前不可观察，不能重新执行');
    await deps.uow.run(scope=>scope.ledger!.job({kind:'migration-job',releaseId:jobId,tag:op.sourceTag,projectId:op.projectId,namespace:service.namespace,jobName:name,
      job:{releaseId:jobId,purpose,image:op.image,command,env:{},envSecret:name+'-env',resources:{cpu:'500m',memory:'1Gi'},activeDeadlineSeconds:3600,ttlSecondsAfterFinished:86400}}));
    return op;
  }
  const next=retainJobProof(proof,observed);
  if(proof&&jsonHash(proof)===jsonHash(next)&&!['succeeded','failed'].includes(next.receipt.state))return op;
  if(next.verification&&next.verification.backupReferenceDigest!==op.backupReferenceDigest)throw conflict('校验回执不是原备份引用');
  const patch=purpose==='database-restore'?{restoreProof:next,restoreJob:next.receipt}:{verifyProof:next,verifyJob:next.receipt,verification:next.verification??null};
  const saved=await c.save(op,{...patch,...(next.receipt.state==='succeeded'?{stage:purpose==='database-restore'?'verifying' as const:'ready-to-switch' as const}:{}),...(next.receipt.state==='failed'?{error:'原恢复 Job 已失败；目标保留，未切换正式数据库'}:{})});
  if(['succeeded','failed'].includes(next.receipt.state))await deps.uow.run(scope=>scope.ledger!.restoreJobObserved(jobId));
  return saved;
}
