import { PLATFORM_ENV as E } from '@crewstation/contracts';
import type { DatabaseMigrationJobPurpose } from '@crewstation/contracts';
import { conflict, precondition } from '@crewstation/kernel';
import type { DatabaseMigrationOperation } from '../../domain/database-migration/operation';
import { migrationOperationKey } from '../../domain/database-migration/operation';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { renderSlotEnv } from '../pipelineEnv';
import { migrationContext } from './context';
export async function freezeMigrationEnvironment(deps:ReleaseUseCaseDeps,op:DatabaseMigrationOperation){
 if(op.environmentBox)return op;
 const c=migrationContext(deps),service=await deps.services.resolveServiceById(op.serviceId);if(!service||!op.manifest)throw precondition('候选 Manifest 尚未固定');
 const rendered=await renderSlotEnv(deps,{projectId:op.projectId,serviceId:op.serviceId,projectSlug:service.slug,serviceName:service.name,physical:op.targetSlot,manifest:op.manifest,databaseGeneration:{id:op.targetGenerationId,operationId:op.id}});
 const source=await c.database.envFor(op.serviceId,op.sourceGenerationId,op.id),scratch=await c.database.envFor(op.serviceId,op.scratchGenerationId,op.id);
 const values={slot:rendered.values,source:source[E.databaseUrl],scratch:scratch[E.databaseUrl]};
 return c.save(op,{environmentBox:await c.support.encrypt(JSON.stringify(values)),environmentVersion:rendered.configVersion});
}
export async function migrationEnvironment(deps:ReleaseUseCaseDeps,op:DatabaseMigrationOperation,purpose?:DatabaseMigrationJobPurpose){
 const c=migrationContext(deps);if(!op.environmentBox)throw precondition('迁移环境尚未冻结');
 const frozen=JSON.parse(await c.support.decrypt(op.environmentBox)) as {slot:Record<string,string>;source:string;scratch:string};
 const target=await c.database.envFor(op.serviceId,op.targetGenerationId,op.id);
 if(target[E.databaseUrl]!==frozen.slot[E.databaseUrl])throw conflict('迁移目标凭据已变化');
 if(!purpose)return frozen.slot;
 const source=await c.database.envFor(op.serviceId,op.sourceGenerationId,op.id),scratch=await c.database.envFor(op.serviceId,op.scratchGenerationId,op.id);
 if(source[E.databaseUrl]!==frozen.source||scratch[E.databaseUrl]!==frozen.scratch)throw conflict('迁移源或 scratch 凭据已变化');
 const jobId=op.currentAttempt!.jobId,token=c.support.token(jobId,op.requestDigest),action=purpose.slice('database-migration-'.length),values={...frozen.slot};
 delete values[E.databaseGenerationId];delete values[E.databaseGenerationOperation];
 Object.assign(values,{[E.databaseMigrationOperationId]:migrationOperationKey(op.id),[E.databaseMigrationSourceGeneration]:op.sourceGenerationId,[E.databaseMigrationSourceUrl]:frozen.source,[E.databaseMigrationTargetUrl]:target[E.databaseUrl]!,[E.databaseMigrationScratchUrl]:frozen.scratch,[E.databaseMigrationControlUrl]:`${c.support.controlUrl}/${jobId}/${token}`,[E.databaseMigrationSourceBornOnPostgresql]:'1',[E.databaseMigrationScratchRoot]:'/tmp/database-migration',[E.platformApiUrl]:`${c.support.objectReadUrl}/${jobId}`,[E.platformApiToken]:token});
 if(action!=='verify')values[E.databaseMigrationAction]=action;
 if(action==='run')values[E.databaseMigrationApprove]=op.approval!.digest;
 if(action==='run'||action==='rollback')values[E.databaseMigrationFreezeReference]=op.freeze!.reference;
 const key=op.manifest!.spec.service.databaseMigration!.sourceKeyConfig;
 if(key){if(values[key]===undefined)throw precondition('迁移源密钥配置缺失');values[E.databaseMigrationSourceKey]=values[key]!;}
 return values;
}
export function migrationScratchSize(op:DatabaseMigrationOperation):string {
 const required=op.plan?.plan.payload.estimates?.['requiredBytes'];
 return typeof required==='number'&&Number.isSafeInteger(required)&&required>0?String(Math.max(20*1024**3,required)):'20Gi';
}
