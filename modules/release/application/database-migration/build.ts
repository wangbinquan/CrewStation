import { newResourceId, precondition } from '@crewstation/kernel';
import type { DatabaseMigrationOperation } from '../../domain/database-migration/operation';
import type { Release } from '../../domain/release';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { buildSteps } from '../pipelineBuild';
import { createPipelineContext, DONE } from '../pipelineContext';
import { prepareReleaseImage } from '../releaseImage';
import { migrationContext } from './context';
import { migrationPlanId } from './jobs';
export async function buildMigrationCandidate(deps:ReleaseUseCaseDeps,op:DatabaseMigrationOperation){
 const c=migrationContext(deps),service=await deps.services.resolveServiceById(op.serviceId);if(!service)throw precondition('原服务不可用');
 let release=await deps.uow.read.releases.getById(op.candidateReleaseId);
 if(!release){
  const now=deps.clock.now();release={id:op.candidateReleaseId,projectId:op.projectId,serviceId:op.serviceId,tag:op.candidateTag,branch:op.branch,commitSha:op.commitSha,status:'pending',targetSlot:op.targetSlot,pipeline:{step:0,databaseMigration:{operationId:op.id,generationId:op.targetGenerationId}},createdBy:op.createdBy,createdAt:now,updatedAt:now};
  await deps.uow.read.releases.insert(release);
 }
 if(release.status==='failed')throw precondition(release.message??'迁移候选构建失败');
 if(release.status==='pending'){
  release=await prepareReleaseImage(deps,release);
  assertMigrationManifest(release);
  if(!await deps.plans.getServicePlan(migrationPlanId(release.manifest!),op.projectId))throw precondition('迁移套餐不可用');
 }
 const steps=buildSteps(deps,createPipelineContext(deps),async()=>DONE);
 const result=release.status==='pending'?await steps.startBuild(release,service):await steps.pollBuild(release,service);
 if(!result.done)return op;
 release=(await deps.uow.read.releases.getById(op.candidateReleaseId))!;
 if(release.status==='failed')throw precondition(release.message??'迁移候选构建失败');
 assertMigrationManifest(release);
 if(!release.image||!/@sha256:[a-f0-9]{64}$/.test(release.image))throw precondition('迁移镜像未固定到摘要');
 return c.save(op,{image:release.image,manifest:release.manifest!,stage:'planning'});
}
function assertMigrationManifest(release:Release){
 const manifest=release.manifest;
 if(!manifest?.spec.service.databaseMigration)throw precondition('候选版本未声明数据库迁移命令',{code:'database_migration_unsupported'});
 if(manifest.kind!=='DigitalWorker'||manifest.spec.tasks?.executionControl!=='fenced')throw precondition('候选版本必须支持 fenced 执行控制');
 if(manifest.spec.env.some(e=>e.name.startsWith('CS_DATABASE_')))throw precondition('候选不能覆盖平台数据库变量');
}

/** A failed immutable Kubernetes Job needs a fresh identity; the candidate, source SHA and tag stay fixed. */
export async function retryMigrationBuild(deps:ReleaseUseCaseDeps,op:DatabaseMigrationOperation){
 const release=await deps.uow.read.releases.getById(op.candidateReleaseId);if(!release||release.status!=='failed')return;
 const {buildRef:_ref,buildStartedAt:_started,jobs:_jobs,...pipeline}=release.pipeline;
 await deps.uow.read.releases.update({...release,status:'pending',message:undefined,pipeline:{...pipeline,step:pipeline.step+1,buildJobId:newResourceId(),previousBuildJobIds:[...(pipeline.previousBuildJobIds??[]),pipeline.buildJobId??release.id]},updatedAt:deps.clock.now()});
}
