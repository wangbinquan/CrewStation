import { DomainTopic } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { DatabaseRestoreOperation } from '../../domain/databaseRestore';
import type { Release } from '../../domain/release';
import { nextWorkload, withSlot } from '../../domain/slots';
import { slotRolloutOf } from '../../domain/ledgerProjection';
import { restoreContext } from './context';
import { restoreEnvironment } from './jobs';
import type { ReleaseUseCaseDeps } from '../dependencies';

function candidate(op:DatabaseRestoreOperation,now:Date):Release {
  return {id:op.candidateReleaseId,projectId:op.projectId,serviceId:op.serviceId,tag:op.sourceTag+(op.sourceTag.includes('+')?'.':'+')+'restore.'+op.id.replaceAll('-',''),commitSha:op.sourceCommit,branch:op.sourceBranch,status:'deploying',targetSlot:op.targetSlot,image:op.image,manifest:op.manifest,
    configVersion:op.environmentVersion!,pipeline:{step:1,deployStartedAt:now.toISOString(),executionMaterials:op.executionMaterials,...(op.runtimeImage?{runtimeImage:op.runtimeImage}:{}),databaseRestore:{operationId:op.id,generationId:op.targetGenerationId,sourceReleaseId:op.restoreReleaseId}},createdBy:op.createdBy,createdAt:now,updatedAt:now};
}
async function writeBarrier(deps:ReleaseUseCaseDeps,op:DatabaseRestoreOperation){
  if(!await deps.maintenance.open(op.serviceId))throw precondition('原恢复维护窗口已关闭，不能继续切换');
  const result=await deps.executionHandoff!.migrationBarrier!(op.serviceId,{operationId:op.id,targetReleaseId:op.candidateReleaseId,expectedActiveReleaseId:op.sourceReleaseId});
  if(!result.ready)return false;
  return deps.executionHandoff!.observeWritersStopped!(op.serviceId);
}
export async function freezeForRestore(deps:ReleaseUseCaseDeps,op:DatabaseRestoreOperation){
  const c=restoreContext(deps);if(!op.switchActor)throw precondition('恢复切换缺少管理员确认');
  await c.authorize(op.switchActor,op.serviceId);
  if(op.maintenanceRevision===null){const window=await deps.maintenance.enterRestore!(op.switchActor,op.serviceId,op.id);return c.save(op,{maintenanceRevision:window.revision,maintenanceWasOpen:window.wasOpen});}
  if(!await writeBarrier(deps,op))return op;
  const plan=await deps.plans.getServicePlan(op.manifest.spec.service.servicePlanId,op.projectId);
  if(!plan||op.manifest.spec.service.replicas>plan.maxReplicas)throw precondition('原恢复版本套餐不可用');
  await restoreEnvironment(deps,op);
  return deps.uow.run(async scope=>{
    const slots=await scope.slots.get(op.serviceId);if(!slots||slots[slots.active].releaseId!==op.sourceReleaseId||slots.active===op.targetSlot)throw conflict('原正式版本变化');
    const now=deps.clock.now(),release=candidate(op,now),old=slots[op.targetSlot];
    if(await scope.releases.getById(release.id))throw conflict('恢复候选已存在但操作尚未记录部署阶段');
    await scope.releases.insert(release);
    const service=op.manifest.spec.service;
    const workload=nextWorkload(old,{releaseId:release.id,image:op.image,command:service.command,port:service.port,healthPath:service.healthPath,...(service.probes?{probes:service.probes}:{}),replicas:service.replicas,resources:{cpu:plan.cpu,memory:plan.memory},databaseGenerationId:op.targetGenerationId,databaseRestoreOperationId:op.id});
    await scope.slots.save(withSlot(slots,{physical:op.targetSlot,releaseId:release.id,state:'deploying',replicas:service.replicas,readyReplicas:0,workload,updatedAt:now},now));
    const next={...op,stage:'deploying' as const,revision:op.revision+1,updatedAt:now.toISOString()};await scope.databaseRestores!.save(op,next);return next;
  });
}
export async function observeRestoreCandidate(deps:ReleaseUseCaseDeps,op:DatabaseRestoreOperation){
  const c=restoreContext(deps);if(!await writeBarrier(deps,op))return null;
  const slots=await deps.uow.read.slots.get(op.serviceId),slot=slots?.[op.targetSlot],service=await deps.services.resolveServiceById(op.serviceId);
  if(!service||!slot?.workload||slot.releaseId!==op.candidateReleaseId||slot.workload.databaseGenerationId!==op.targetGenerationId||slot.workload.databaseRestoreOperationId!==op.id)throw conflict('原恢复候选部署已变化');
  const rollout=slotRolloutOf(await deps.uow.read.ledger!.slot(op.serviceId,op.targetSlot));
  if(rollout.state==='failed'||slot.state==='failed')throw precondition('恢复候选部署未通过探针，保留维护与原数据库');
  if(rollout.state!=='ready')return null;
  return c.support.jobs.candidate({namespace:service.namespace,serviceName:service.name,physical:op.targetSlot,releaseId:op.candidateReleaseId,revision:slot.workload.revision,image:op.image,environment:await restoreEnvironment(deps,op)});
}
export async function readyRestoreCandidate(deps:ReleaseUseCaseDeps,op:DatabaseRestoreOperation){
  const proof=await observeRestoreCandidate(deps,op);if(!proof)return op;
  const openapi=op.manifest.kind!=='EventProducer'&&op.manifest.spec.apis.exposes?await deps.repo.readFile(op.serviceId,op.sourceCommit,op.manifest.spec.apis.exposes.openapi.replace(/^\.\//,'')):undefined;
  return deps.uow.run(async scope=>{
    const slots=await scope.slots.get(op.serviceId),release=await scope.releases.getById(op.candidateReleaseId);if(!slots||!release)throw conflict('恢复候选已不存在');
    const now=deps.clock.now(),slot=slots[op.targetSlot];if(slot.releaseId!==op.candidateReleaseId)throw conflict('恢复候选已变化');
    await scope.slots.save(withSlot(slots,{...slot,state:'ready',readyReplicas:slot.replicas,updatedAt:now},now));
    await scope.releases.update({...release,status:'ready',pipeline:{...release.pipeline,readyAt:now.toISOString()},updatedAt:now});
    await scope.events.publish(DomainTopic.releaseRegistered,{occurredAt:now.toISOString(),projectId:op.projectId,serviceId:op.serviceId,releaseId:release.id,tag:release.tag,commitSha:release.commitSha,executionMaterials:op.executionMaterials,manifest:op.manifest,...(openapi?{openapiDocument:Bun.YAML.parse(openapi)}:{})});
    const next={...op,stage:'switching' as const,candidateProof:proof,revision:op.revision+1,updatedAt:now.toISOString()};await scope.databaseRestores!.save(op,next);return next;
  });
}
export async function switchRestoreCandidate(deps:ReleaseUseCaseDeps,op:DatabaseRestoreOperation){
  const c=restoreContext(deps),handoff=await deps.uow.read.handoffs.get(op.id);
  if(handoff?.stage==='complete'){
    const binding=await c.database.active(op.serviceId,'production'),authority=await deps.executionHandoff!.inspect(op.serviceId);
    if(binding.generationId!==op.targetGenerationId||authority.stage!=='complete'||authority.targetReleaseId!==op.candidateReleaseId||!await deps.executionHandoff!.observeRoute(op.serviceId,op.candidateReleaseId,op.targetSlot))throw conflict('数据、路由与执行权尚未对账');
    await c.database.envFor(op.serviceId,op.targetGenerationId,op.id);
    await deps.maintenance.exitRestore!(op.switchActor!,op.serviceId,op.id,op.maintenanceRevision!);
    await c.database.finish(op.serviceId,op.id);
    return c.save(op,{stage:'completed'});
  }
  if(!handoff){
    const proof=await observeRestoreCandidate(deps,op);if(!proof)return op;
    if(!op.candidateProof||jsonHash(proof)!==jsonHash(op.candidateProof))throw conflict('确认后的恢复候选物理绑定变化');
    await c.database.commit({operationId:op.id,serviceId:op.serviceId,sourceGenerationId:op.sourceGenerationId,targetGenerationId:op.targetGenerationId,expectedRevision:op.sourceBindingRevision});
    const now=deps.clock.now().toISOString();
    // The handoff and the operation's committed mark share one transaction: from here only forward completion remains.
    return deps.uow.run(async scope=>{await scope.slots.get(op.serviceId);
      if(!await scope.handoffs.get(op.id))await scope.handoffs.insert({id:op.id,requestKey:'database-restore:'+op.id,projectId:op.projectId,serviceId:op.serviceId,expectedActiveReleaseId:op.sourceReleaseId,targetReleaseId:op.candidateReleaseId,targetSlot:op.targetSlot,stage:'freezing',actorUserId:op.switchActor!.userId,reason:'数据库恢复 '+op.id,createdAt:now,updatedAt:now,revision:1,owner:null,leaseUntil:null});
      const next={...op,switchCommitted:true,revision:op.revision+1,updatedAt:now};await scope.databaseRestores!.save(op,next);return next;});
  }
  return op.switchCommitted?op:c.save(op,{switchCommitted:true});
}
