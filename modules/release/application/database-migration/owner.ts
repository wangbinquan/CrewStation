import { conflict, precondition } from '@crewstation/kernel';
import type { JobRef } from '../../api/moduleApi';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { migrationContext } from './context';
import { migrationEnvironment } from './environment';
import { migrationJobIdentity } from './callbacks';
import { migrationJobPurpose } from '../../domain/database-migration/operation';
export async function databaseMigrationJobEnvironment(deps:ReleaseUseCaseDeps,ref:JobRef){
 const c=migrationContext(deps),op=await c.store.forJob(ref.releaseId);
 if(!op||op.error||op.abandonRequested||op.currentAttempt?.purpose!==ref.purpose||migrationJobPurpose(op.stage)!==ref.purpose)throw precondition('迁移已不在这个 Job 阶段');
 const record=await deps.uow.read.ledger!.jobRecord(ref.releaseId,'migration-job');if(record?.id!==ref.recordId)throw conflict('迁移 Job 资源身份变化');
 return migrationEnvironment(deps,op,op.currentAttempt.purpose);
}
export async function migrationObjectSource(deps:ReleaseUseCaseDeps,jobId:string,token:string){
 const op=await migrationJobIdentity(deps,jobId,token);if(!op||op.manifest?.kind!=='DigitalWorker'||!op.manifest.spec.data?.objects.planId)return undefined;
 const service=await deps.services.resolveServiceById(op.serviceId);if(service?.projectId!==op.projectId)return undefined;
 return {projectId:op.projectId,serviceId:op.serviceId,env:'production' as const,fenced:false as const,writeAllowed:false as const,planId:op.manifest.spec.data.objects.planId};
}
