import { conflict, jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { DatabaseMigrationJobPurpose, Manifest } from '@crewstation/contracts';
import type { DatabaseMigrationOperation, MigrationJobProof } from '../../domain/database-migration/operation';
import { retainJobProof } from '../../domain/databaseRestore';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { migrationContext } from './context';
import { freezeMigrationEnvironment, migrationEnvironment, migrationScratchSize } from './environment';
import { migrationJobEvidence } from './jobEvidence';
/** Migration Jobs run with the plan the candidate declares for the migration, else with the service's own plan. */
export const migrationPlanId=(manifest:Manifest)=>manifest.spec.service.databaseMigration?.servicePlanId??manifest.spec.service.servicePlanId;
export async function progressMigrationJob(deps:ReleaseUseCaseDeps,original:DatabaseMigrationOperation,purpose:DatabaseMigrationJobPurpose,closing=false){
 const c=migrationContext(deps);let op=await freezeMigrationEnvironment(deps,original);
 if(op.currentAttempt?.purpose!==purpose){
  op=await c.save(op,{previousAttempts:op.currentAttempt?[...op.previousAttempts,op.currentAttempt]:op.previousAttempts,currentAttempt:{jobId:newResourceId(),purpose,proof:null,receiptDigest:null}});
 }
 const attempt=op.currentAttempt!,jobId=attempt.jobId,name='dbm-'+jobId.replaceAll('-',''),proof=attempt.proof;
 const service=await deps.services.resolveServiceById(op.serviceId);if(!service||!op.manifest||!op.image)throw precondition('迁移候选尚未固定');
 const command=purpose==='database-migration-verify'?op.manifest.spec.service.databaseMigration!.verifyCommand:op.manifest.spec.service.databaseMigration!.command;
 const target=await c.database.prepare(op.serviceId,op.id,op.targetGenerationId);if(!target.ready||!target.identity)throw precondition('迁移目标尚未就绪');
 const environment=await migrationEnvironment(deps,op,purpose);
 let next:MigrationJobProof|null=await c.support.jobs.observe({namespace:service.namespace,name,jobId,purpose,image:op.image,command,target:target.identity,environment,previous:proof});
 if(!next){
  const record=await deps.uow.read.ledger!.jobRecord(jobId,'migration-job');
  if(!record?.conditions.some(condition=>condition.type==='Created'&&condition.status==='true')&&!closing){
   const plan=await deps.plans.getServicePlan(migrationPlanId(op.manifest),op.projectId);if(!plan)throw precondition('迁移套餐不可用');
   await deps.uow.run(scope=>scope.ledger!.job({kind:'migration-job',releaseId:jobId,tag:op.candidateTag,projectId:op.projectId,namespace:service.namespace,jobName:name,job:{releaseId:jobId,purpose,image:op.image,command,env:{},envSecret:name+'-env',resources:{cpu:plan.cpu,memory:plan.memory},activeDeadlineSeconds:3600,ttlSecondsAfterFinished:86400,scratchSize:migrationScratchSize(op)}}));return op;
  }
  if(closing&&record&&!record.conditions.some(condition=>condition.type==='Created'&&condition.status==='true'))await deps.uow.read.ledger!.failJob(jobId,'migration-job','迁移关闭，停止未启动尝试');
  next={receipt:{name,uid:'unobserved',image:op.image,target:target.identity,state:'failed',exitCode:null,failure:'job-lost'},secretUid:'unobserved',environmentDigest:jsonHash(environment),podUid:null};
 }
 retainJobProof(proof,next);
 let patch:Partial<DatabaseMigrationOperation>={};
 if(next.receipt.state==='succeeded'&&!closing){
  try{patch=await migrationJobEvidence(deps,op,next);}catch(error){
   if(!(error instanceof Error))throw error;
   // Artifact IO outages stay observations; malformed or mismatched evidence ends this attempt.
   if('kind' in error&&error.kind!=='conflict'&&error.kind!=='validation')throw error;
   if(!('kind' in error)&&error.name!=='SyntaxError'&&error.name!=='ZodError')throw error;
   next={...next,receipt:{...next.receipt,state:'failed',failure:next.output?'receipt-mismatch':'receipt-invalid'}};
  }
 }
 if(proof&&jsonHash(proof)===jsonHash(next)&&!['succeeded','failed'].includes(next.receipt.state))return op;
 const currentAttempt={...attempt,proof:next,...(patch.currentAttempt?{receiptDigest:patch.currentAttempt.receiptDigest}:{})};
 const saved=await c.save(op,{...patch,currentAttempt,observation:null,...(!closing&&next.receipt.state==='failed'?{error:`迁移 Job 失败（${next.receipt.failure??'exit'}），可在原操作中重试`}: {})});
 if(['succeeded','failed'].includes(next.receipt.state))await deps.uow.run(scope=>scope.ledger!.restoreJobObserved(jobId));
 return saved;
}
export async function assertMigrationJobsStopped(deps:ReleaseUseCaseDeps,op:DatabaseMigrationOperation){
 // An abandon/rollback cannot release the freeze while an older Job can still write.
 for(const attempt of [...op.previousAttempts,...(op.currentAttempt&&op.currentAttempt.purpose!=='database-migration-rollback'?[op.currentAttempt]:[])]){
  if(attempt.proof&&['succeeded','failed'].includes(attempt.proof.receipt.state))continue;
  const record=await deps.uow.read.ledger!.jobRecord(attempt.jobId,'migration-job');
  if(record&&!record.conditions.some(c=>['Finished','Failed'].includes(c.type)&&c.status==='true'))throw conflict('等待原迁移 Job 终止',{code:'restore_job_terminating'});
 }
}
