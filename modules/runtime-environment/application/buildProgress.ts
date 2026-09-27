import { precondition } from '@crewstation/kernel';
import type { ImageBuild, ImageRevision } from '../domain/records';
import { verifyImageLineage } from '../domain/imageLineage';
import type { BuildObservation, RuntimeImageBuildExecutor } from '../ports/buildExecutor';
import type { RuntimeImageDeps } from './dependencies';
import { updateClaimedBuild } from './buildLeases';

export async function recordBuildObservation(deps: RuntimeImageDeps, build: ImageBuild, observation: BuildObservation): Promise<ImageBuild | undefined> {
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

export async function inspectBuildResult(executor: RuntimeImageBuildExecutor, build: ImageBuild, revision: ImageRevision, observation?: BuildObservation) {
  if (revision.source.kind === 'source') {
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
