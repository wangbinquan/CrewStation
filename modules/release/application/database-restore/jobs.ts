import type { DatabaseRestoreOperation, RestoreJobProof } from '../../domain/databaseRestore';
import { failedJobProof, restoreJobName, retainJobProof } from '../../domain/databaseRestore';
import { PLATFORM_ENV } from '@crewstation/contracts';
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
  if(values[PLATFORM_ENV.databaseUrl]!==target[PLATFORM_ENV.databaseUrl])throw conflict('原恢复目标凭据已变化');
  if(purpose){
    // The reference is injected verbatim; its digest is SHA-256 of these exact bytes (see PLATFORM_ENV.databaseRestoreReference).
    const jobId=purpose==='database-restore'?op.restoreJobId:op.verifyJobId;
    return {...values,[PLATFORM_ENV.databaseRestoreReference]:op.backupReference,[PLATFORM_ENV.databaseRestoreOperation]:op.id,
      [PLATFORM_ENV.objectsUrl]:c.support.objectReadUrl.replace(/\/$/,'')+'/'+jobId,[PLATFORM_ENV.databaseRestoreObjectsToken]:c.support.token(jobId,op.requestDigest)};
  }
  return values;
}
export async function freezeRestoreEnvironment(deps:ReleaseUseCaseDeps,op:DatabaseRestoreOperation){
  if(op.environmentBox)return op;
  const c=restoreContext(deps),service=await deps.services.resolveServiceById(op.serviceId);if(!service)throw precondition('原服务已不可用');
  const env=await renderSlotEnv(deps,{projectId:op.projectId,serviceId:op.serviceId,projectSlug:service.slug,serviceName:service.name,physical:op.targetSlot,manifest:op.manifest,databaseGeneration:{id:op.targetGenerationId,operationId:op.id}});
  return c.save(op,{environmentBox:await c.support.encrypt(JSON.stringify(env.values)),environmentVersion:env.configVersion});
}
/** Restore and verify Jobs run with the service plan's resources, like the candidate slot (not a fixed 500m). */
async function jobResources(deps:ReleaseUseCaseDeps,op:DatabaseRestoreOperation){
  const plan=await deps.plans.getServicePlan(op.manifest.spec.service.servicePlanId,op.projectId);
  if(!plan)throw precondition('原恢复版本的服务套餐不可用');
  return {cpu:plan.cpu,memory:plan.memory};
}
export async function progressRestoreJob(deps:ReleaseUseCaseDeps,op:DatabaseRestoreOperation,purpose:'database-restore'|'database-verify'){
  const c=restoreContext(deps),service=await deps.services.resolveServiceById(op.serviceId);if(!service)throw precondition('原服务已不可用');
  const jobId=purpose==='database-restore'?op.restoreJobId:op.verifyJobId,proof=purpose==='database-restore'?op.restoreProof:op.verifyProof;
  const name=restoreJobName(jobId,purpose),command=purpose==='database-restore'?op.manifest.spec.service.databaseRestore!.command:op.manifest.spec.service.databaseRestore!.verifyCommand;
  const target=await c.database.prepare(op.serviceId,op.id,op.targetGenerationId);
  if(!target.ready||!target.identity)throw precondition('原目标数据库身份或凭据尚不可确认');
  const environment=await restoreEnvironment(deps,op,purpose);
  let next:RestoreJobProof|null=await c.support.jobs.observe({namespace:service.namespace,name,jobId,purpose,image:op.image,command,target:target.identity,environment,previous:proof});
  if(!next){
    const record=await deps.uow.read.ledger!.jobRecord(jobId,'migration-job');
    if(!record?.conditions.some(c=>c.type==='Created'&&c.status==='true')){
      const resources=await jobResources(deps,op);
      await deps.uow.run(scope=>scope.ledger!.job({kind:'migration-job',releaseId:jobId,tag:op.sourceTag,projectId:op.projectId,namespace:service.namespace,jobName:name,
        job:{releaseId:jobId,purpose,image:op.image,command,env:{},envSecret:name+'-env',resources,activeDeadlineSeconds:3600,ttlSecondsAfterFinished:86400}}));
      return op;
    }
    // Created but gone before any observation, and no Pod of that name runs: the attempt ended unobserved and may be retried.
    next=failedJobProof({receipt:{name,uid:'unobserved',image:op.image,target:target.identity,state:'pending',exitCode:null},secretUid:'unobserved',environmentDigest:jsonHash(environment),podUid:null},'job-lost');
  }
  next=retainJobProof(proof,next);
  if(next.verification&&next.verification.backupReferenceDigest!==op.backupReferenceDigest)next=failedJobProof(next,'receipt-mismatch');
  if(proof&&jsonHash(proof)===jsonHash(next)&&!['succeeded','failed'].includes(next.receipt.state))return op;
  const patch=purpose==='database-restore'?{restoreProof:next,restoreJob:next.receipt}:{verifyProof:next,verifyJob:next.receipt,verification:next.verification??null};
  const failed=next.receipt.state==='failed'?`原${purpose==='database-restore'?'恢复':'校验'} Job 尝试失败（${next.receipt.failure??'exit'}）；目标保留，未切换正式数据库，可在原操作中重试新尝试`:null;
  const saved=await c.save(op,{...patch,observation:null,...(next.receipt.state==='succeeded'?{stage:purpose==='database-restore'?'verifying' as const:'ready-to-switch' as const}:{}),...(failed?{error:failed}:{})});
  if(['succeeded','failed'].includes(next.receipt.state))await deps.uow.run(scope=>scope.ledger!.restoreJobObserved(jobId));
  return saved;
}
