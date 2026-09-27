import { isPlatformError, newResourceId } from '@crewstation/kernel';
import type { ImageBuild } from '../domain/records';
import type { RuntimeImageBuildExecutor } from '../ports/buildExecutor';
import type { RuntimeImageDeps } from './dependencies';
import { claimBuild, releaseBuildClaim, updateClaimedBuild } from './buildLeases';
import { inspectBuildResult, recordBuildObservation } from './buildProgress';
import { completeBuild } from './buildCompletion';

export function runtimeImageBuildController(deps: RuntimeImageDeps, executor: RuntimeImageBuildExecutor) {
  const patch = (build: ImageBuild, fields: Partial<ImageBuild>) => updateClaimedBuild(deps, build, async (_s, current) => ({ ...current, ...fields, updatedAt: deps.clock.now().toISOString() }));
  const runBuild = async (id: string): Promise<void> => {
    let claimed = await claimBuild(deps, id, newResourceId());
    if (!claimed) return;
    try {
      const revision = await deps.uow.read.revisions.get(claimed.revisionId);
      if (!revision) throw new Error('镜像修订记录缺失');
      if (claimed.state === 'cancelling' || claimed.pendingOutcome) { await completeBuild(deps, executor, claimed, revision); return; }
      if (claimed.deadline <= deps.clock.now().toISOString()) {
        claimed = await patch(claimed, { pendingOutcome: { state: 'failed', error: '镜像构建超过截止时间' }, stage: 'stopping' });
        if (claimed) await completeBuild(deps, executor, claimed, revision); return;
      }
      if (claimed.state === 'queued') claimed = await patch(claimed, { state: 'preparing', stage: 'preparing' });
      if (!claimed) return;
      const observation = revision.source.kind !== 'existing' ? await executor.reconcile(claimed, revision, 'run') : undefined;
      if (observation) claimed = await recordBuildObservation(deps, claimed, observation);
      if (!claimed) return;
      if (observation?.state === 'unknown') return;
      if (observation?.state === 'pending' || observation?.state === 'running') {
        await patch(claimed, { state: 'building', stage: 'building' }); return;
      }
      if (observation && observation.state !== 'succeeded') {
        claimed = await patch(claimed, { stage: 'stopping', pendingOutcome: { state: 'failed', error: observation.error ?? '构建未成功完成' } });
      } else {
        claimed = await patch(claimed, { state: 'inspecting', stage: 'inspecting' });
        if (!claimed) return;
        const inspecting = claimed;
        try { const image = await inspectBuildResult(executor, inspecting, revision, observation); claimed = await patch(inspecting, { pendingOutcome: { state: 'succeeded', image }, stage: 'stopping' }); }
        catch (error) {
          if (isPlatformError(error) && error.kind === 'unavailable') throw error;
          claimed = await patch(inspecting, { pendingOutcome: { state: 'failed', error: '构建产物的身份、摘要、架构或底座校验失败' }, stage: 'stopping' });
        }
      }
      if (claimed) await completeBuild(deps, executor, claimed, revision);
    } catch {
      // 未知外部错误不宣告失败或释放资源；下一轮检查原资源，避免误报停止。
      if (claimed) await patch(claimed, { unknown: true });
      deps.logger.warn('runtime image build reconciliation unavailable', { buildId: id });
    } finally { if (claimed) await releaseBuildClaim(deps, claimed); }
  };
  return { runBuild, reconcileBuilds: async () => {
    for (const build of await deps.uow.read.builds.runnable(deps.clock.now().toISOString(), deps.limits.platformBuilds)) await runBuild(build.id);
  } };
}
