import { DomainTopic } from '@crewstation/contracts';
import { conflict, precondition } from '@crewstation/kernel';
import type { DatabaseMigrationOperation } from '../../domain/database-migration/operation';
import { nextWorkload, withSlot } from '../../domain/slots';
import { slotRolloutOf } from '../../domain/ledgerProjection';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { migrationContext } from './context';
import { migrationEnvironment } from './environment';
import { migrationBarrier } from './freeze';
import { migrationJobEvidence } from './jobEvidence';
export const migrationBindingInput=(op:DatabaseMigrationOperation)=>({operationId:op.id,serviceId:op.serviceId,sourceGenerationId:op.sourceGenerationId,targetGenerationId:op.targetGenerationId,expectedRevision:op.sourceBindingRevision});
async function deployMigrationCandidate(deps:ReleaseUseCaseDeps,op:DatabaseMigrationOperation){
 const manifest=op.manifest!,plan=await deps.plans.getServicePlan(manifest.spec.service.servicePlanId,op.projectId);
 if(!plan||manifest.spec.service.replicas>plan.maxReplicas)throw precondition('迁移候选套餐不可用');
 await deps.uow.run(async scope=>{
  const slots=await scope.slots.get(op.serviceId),release=await scope.releases.getById(op.candidateReleaseId);
  if(!slots||!release||slots[slots.active].releaseId!==op.sourceReleaseId||slots.active===op.targetSlot)throw conflict('迁移原生产槽已变化');
  const old=slots[op.targetSlot];if(old.releaseId===op.candidateReleaseId&&old.workload?.databaseMigrationOperationId===op.id)return;
  const now=deps.clock.now(),service=manifest.spec.service;
  const workload=nextWorkload(old,{releaseId:release.id,image:op.image!,command:service.command,port:service.port,healthPath:service.healthPath,...(service.probes?{probes:service.probes}:{}),replicas:service.replicas,resources:{cpu:plan.cpu,memory:plan.memory},databaseGenerationId:op.targetGenerationId,databaseMigrationOperationId:op.id});
  await scope.releases.update({...release,status:'deploying',configVersion:op.environmentVersion!,pipeline:{...release.pipeline,deployStartedAt:now.toISOString()},updatedAt:now});
  await scope.slots.save(withSlot(slots,{physical:op.targetSlot,releaseId:release.id,state:'deploying',replicas:service.replicas,readyReplicas:0,workload,updatedAt:now},now));
 });
}
export async function observeMigrationCandidate(deps:ReleaseUseCaseDeps,op:DatabaseMigrationOperation){
 const c=migrationContext(deps),slots=await deps.uow.read.slots.get(op.serviceId),slot=slots?.[op.targetSlot],service=await deps.services.resolveServiceById(op.serviceId);
 if(!service||!slot?.workload||slot.releaseId!==op.candidateReleaseId||slot.workload.databaseGenerationId!==op.targetGenerationId||slot.workload.databaseMigrationOperationId!==op.id)throw conflict('迁移候选绑定变化');
 const rollout=slotRolloutOf(await deps.uow.read.ledger!.slot(op.serviceId,op.targetSlot));
 if(rollout.state==='failed'||slot.state==='failed')throw precondition('迁移候选探针失败，维护与冻结保留');
 if(rollout.state!=='ready')return null;
 return c.support.jobs.candidate({namespace:service.namespace,serviceName:service.name,physical:op.targetSlot,releaseId:op.candidateReleaseId,revision:slot.workload.revision,image:op.image!,environment:await migrationEnvironment(deps,op)});
}
export async function activateMigration(deps:ReleaseUseCaseDeps,op:DatabaseMigrationOperation){
 const c=migrationContext(deps);await migrationBarrier(deps,op);
 await migrationJobEvidence(deps,op,op.currentAttempt!.proof!);
 await c.database.commitMigration!(migrationBindingInput(op));
 await deployMigrationCandidate(deps,op);
 const proof=await observeMigrationCandidate(deps,op);if(!proof)return op;
 const release=(await deps.uow.read.releases.getById(op.candidateReleaseId))!,manifest=op.manifest!;
 const openapi=manifest.kind!=='EventProducer'&&manifest.spec.apis.exposes?await deps.repo.readFile(op.serviceId,op.commitSha,manifest.spec.apis.exposes.openapi.replace(/^\.\//,'')):undefined;
 return deps.uow.run(async scope=>{
  const slots=await scope.slots.get(op.serviceId);if(!slots||slots[op.targetSlot].releaseId!==op.candidateReleaseId)throw conflict('迁移候选变化');
  const now=deps.clock.now(),slot=slots[op.targetSlot];
  await scope.slots.save(withSlot(slots,{...slot,state:'ready',readyReplicas:slot.replicas,updatedAt:now},now));
  await scope.releases.update({...release,status:'ready',pipeline:{...release.pipeline,readyAt:now.toISOString()},updatedAt:now});
  await scope.events.publish(DomainTopic.releaseRegistered,{occurredAt:now.toISOString(),projectId:op.projectId,serviceId:op.serviceId,releaseId:release.id,tag:release.tag,commitSha:release.commitSha,executionMaterials:release.pipeline.executionMaterials,manifest,...(openapi?{openapiDocument:Bun.YAML.parse(openapi)}:{})});
  const next={...op,stage:'verifying' as const,candidateProof:proof,revision:op.revision+1,updatedAt:now.toISOString()};await scope.databaseMigrations!.save(op,next);return next;
 });
}
