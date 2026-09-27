import type { ProjectId, RuntimeImageBuildRender } from '@crewstation/contracts';
import type { Clock } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { ImageBuild } from '../../domain/records';
import type { RuntimeBuildIntents, RuntimeBuildLedger } from '../../ports/buildLedger';
import { buildRepository } from './executionRepositories';

const claimedBy = (current: ImageBuild | undefined, supplied: ImageBuild, clock: Clock): current is ImageBuild => !!current && current.epoch === supplied.epoch && current.leaseOwner === supplied.leaseOwner && !!current.leaseUntil && current.leaseUntil > clock.now().toISOString();

/** 资源声明与控制 epoch 同事务，防止旧工作器在取消之后重新创建 builder。 */
export function databaseBuildIntents(db: Database, ledger: RuntimeBuildLedger, clock: Clock): RuntimeBuildIntents {
  return {
    get: (id) => buildRepository(db).get(id),
    declare: (build, plan: RuntimeImageBuildRender) => db.transaction(async (tx) => {
      const repo = buildRepository(tx), current = await repo.get(build.id, true);
      if (!claimedBy(current, build, clock) || current.state === 'cancelling' || current.pendingOutcome || ['succeeded', 'failed', 'cancelled'].includes(current.state)) return false;
      if (!current.resourcePlan) {
        await ledger.within(tx).declare({ id: plan.resourceId, kind: 'build-job', ref: current.id, ...(current.projectId ? { projectId: current.projectId as ProjectId } : {}),
          spec: { children: [{ kind: 'Job', namespace: plan.namespace, name: plan.name }, { kind: 'Secret', namespace: plan.namespace, name: plan.secret }], runtimeImageBuild: plan }, display: { buildId: current.id, imageId: current.imageId } });
        await repo.update({ ...current, resourcePlan: plan });
      }
      return true;
    }),
    stop: (build) => db.transaction(async (tx) => {
      const current = await buildRepository(tx).get(build.id, true);
      if (!claimedBy(current, build, clock)) return false;
      if (current.resourcePlan && current.resourceId) await ledger.within(tx).requestRelease(current.resourceId, { code: 'image-build-ended', message: '镜像构建结束，回收本次 builder 与临时凭据' });
      return true;
    }),
    addCredential: (buildId, executionEpoch, credentialId) => db.transaction(async (tx) => {
      const repo = buildRepository(tx), build = await repo.get(buildId, true);
      if (!build || build.executionEpoch !== executionEpoch || !build.resourcePlan || build.pendingOutcome || ['cancelling', 'cancelled', 'failed', 'succeeded'].includes(build.state)) return false;
      await repo.update({ ...build, gitCredentialIds: [...new Set([...(build.gitCredentialIds ?? []), credentialId])] });
      return true;
    }),
  };
}
