import { isPlatformError, jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { ImageBuild, ImageRevision } from '../domain/records';
import { runtimeImageBuildProjects as projects } from '../domain/records';
import type { BuildObservation, RuntimeImageBuildExecutor } from '../ports/buildExecutor';
import type { RuntimeImageDeps } from './dependencies';
import { claimBuild, releaseBuildClaim, updateClaimedBuild } from './buildLeases';
import { verifyImageLineage } from '../domain/imageLineage';
import { completeBuild } from './buildCompletion';

export function runtimeImageBuildController(deps: RuntimeImageDeps, originalExecutor: RuntimeImageBuildExecutor) {
  const check = async (build: ImageBuild, revision: ImageRevision) => { const ids = projects(build, revision); if (ids.length) await deps.projectAdmissions?.check(ids); };
  const executor: RuntimeImageBuildExecutor = {
    reconcile: async (build, revision, action) => { await check(build, revision); return originalExecutor.reconcile(build, revision, action); },
    inspect: async (build, revision, receipt) => { await check(build, revision); return originalExecutor.inspect(build, revision, receipt); },
  };
  const patch = (build: ImageBuild, fields: Partial<ImageBuild>) => updateClaimedBuild(deps, build, async (_s, current) => ({ ...current, ...fields, updatedAt: deps.clock.now().toISOString() }));
  const reconcileBuild = async (id: string): Promise<void> => {
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
  const runBuild = async (id: string): Promise<void> => {
    if (!deps.projectAdmissions) return reconcileBuild(id);
    const build = await deps.uow.read.builds.get(id);
    if (!build || ['succeeded', 'failed', 'cancelled'].includes(build.state)) return;
    const revision = await deps.uow.read.revisions.get(build.revisionId), ids = projects(build, revision);
    return deps.projectAdmissions.run(ids, { kind: 'build', id, inputDigest: jsonHash({ id, inputDigest: build.inputDigest, revisionId: build.revisionId, executionEpoch: build.executionEpoch, projectIds: ids }) }, () => reconcileBuild(id));
  };
  return { runBuild, reconcileBuilds: async () => {
    for (const build of await deps.uow.read.builds.runnable(deps.clock.now().toISOString(), deps.limits.platformBuilds)) await runBuild(build.id);
  } };
}

async function recordBuildObservation(deps: RuntimeImageDeps, build: ImageBuild, observation: BuildObservation): Promise<ImageBuild | undefined> {
  if (observation.resourceId !== build.resourceId) throw precondition('构建资源身份不匹配');
  if (build.podUid && observation.podUid && observation.podUid !== build.podUid) throw precondition('原构建 Pod 已被替换，不能接收新实例结果');
  return updateClaimedBuild(deps, build, async (s, current) => {
    const logs = observation.logs;
    if (logs && logs.cursor !== current.logCursor) {
      let remaining = Math.max(0, deps.limits.logMaxBytes - await s.logs.bytes(build.id));
      for (const line of logs.lines) {
        const text = Buffer.from(line).subarray(0, remaining).toString('utf8');
        const length = Buffer.byteLength(text);
        if (!remaining || length > remaining) break;
        await s.logs.append(build.id, { stage: current.stage, text, createdAt: deps.clock.now().toISOString() }); remaining -= length;
      }
    }
    return { ...current, ...(observation.podUid ? { podUid: observation.podUid } : {}), ...(logs ? { logCursor: logs.cursor } : {}), unknown: observation.state === 'unknown' };
  });
}

async function inspectBuildResult(executor: RuntimeImageBuildExecutor, build: ImageBuild, revision: ImageRevision, observation?: BuildObservation) {
  if (revision.source.kind !== 'existing') {
    const receipt = observation?.receipt;
    if (!receipt || receipt.buildId !== build.id || receipt.executionEpoch !== build.executionEpoch || !build.podUid || receipt.podUid !== build.podUid) throw precondition('镜像构建结果未绑定原 build、epoch 与 Pod UID');
  }
  const { image, base } = await executor.inspect(build, revision, observation?.receipt);
  if (!/^sha256:[0-9a-f]{64}$/.test(image.digest) || image.architecture !== revision.source.architecture || /[@\s]/.test(image.repository)) throw precondition('镜像产物摘要、仓库或架构不符合构建快照');
  if (revision.source.usage !== 'service') {
    if (!base) throw precondition('未取得受支持平台底座的基础层信息');
    verifyImageLineage(base.diffIds, image.diffIds);
  }
  return image;
}
