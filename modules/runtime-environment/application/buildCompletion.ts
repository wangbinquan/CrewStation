import { newResourceId } from '@crewstation/kernel';
import type { ImageBuild, ImageRevision } from '../domain/records';
import { imageContentDigest } from '../domain/contentDigest';
import type { RuntimeImageBuildExecutor } from '../ports/buildExecutor';
import type { RuntimeImageDeps } from './dependencies';
import { updateClaimedBuild } from './buildLeases';

/** 成功、失败、取消都要先物理停止。故障或 unknown 时保留容量与 pendingOutcome，重启后继续清理。 */
export async function completeBuild(deps: RuntimeImageDeps, executor: RuntimeImageBuildExecutor, build: ImageBuild, revision: ImageRevision): Promise<void> {
  if (revision.source.kind !== 'existing') {
    const observed = await executor.reconcile(build, revision, 'stop');
    if (observed.state !== 'stopped' || observed.resourceId !== build.resourceId) return;
  }
  await updateClaimedBuild(deps, build, async (s, current) => {
    const at = deps.clock.now().toISOString(), outcome = current.pendingOutcome;
    const { leaseOwner: _owner, leaseUntil: _until, ...rest } = current;
    if (current.state === 'cancelling') return { ...rest, state: 'cancelled', stage: 'cancelled', unknown: false, updatedAt: at };
    if (!outcome) return current;
    if (outcome.state === 'failed') return { ...rest, state: 'failed', stage: 'failed', error: outcome.error, unknown: false, updatedAt: at };
    const version = { id: newResourceId(), imageId: current.imageId, revisionId: revision.id, buildId: current.id, repository: outcome.image.repository, digest: outcome.image.digest, architecture: outcome.image.architecture, state: 'available' as const, createdAt: at, initializerDigest: imageContentDigest(revision.initializer), toolsDigest: imageContentDigest(revision.tools) };
    // 同 digest 的新版本登记与删除共用锁；版本创建和成功状态在同一事务提交。
    await s.lock(`digest:${version.repository}@${version.digest}`);
    await s.versions.insert(version);
    return { ...rest, state: 'succeeded', stage: 'succeeded', versionId: version.id, updatedAt: at, unknown: false };
  });
}
