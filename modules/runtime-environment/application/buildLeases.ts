import type { ImageBuild } from '../domain/records';
import { occupiesBuildCapacity } from '../domain/buildState';
import type { RuntimeImageDeps } from './dependencies';
import type { RepositoryScope } from '../ports/unitOfWork';

export async function claimBuild(deps: RuntimeImageDeps, id: string, owner: string): Promise<ImageBuild | undefined> {
  return deps.uow.run(async (s) => {
    const old = await s.builds.get(id, true), at = deps.clock.now();
    if (!old || !occupiesBuildCapacity(old.state) || (old.leaseUntil && old.leaseUntil > at.toISOString())) return undefined;
    const next: ImageBuild = { ...old, epoch: old.epoch + 1, leaseOwner: owner, leaseUntil: new Date(at.getTime() + 60000).toISOString() };
    await s.builds.update(next); return next;
  });
}

/** 租约超时／取消后晚到的工作器结果不能提交，即使 epoch 字面值恰好相同。 */
export async function updateClaimedBuild(deps: RuntimeImageDeps, claimed: ImageBuild, update: (scope: RepositoryScope, current: ImageBuild) => Promise<ImageBuild>): Promise<ImageBuild | undefined> {
  return deps.uow.run(async (s) => {
    const current = await s.builds.get(claimed.id, true), now = deps.clock.now().toISOString();
    if (!current || current.epoch !== claimed.epoch || current.leaseOwner !== claimed.leaseOwner || !current.leaseUntil || current.leaseUntil <= now || !occupiesBuildCapacity(current.state)) return undefined;
    const result = await update(s, current);
    await s.builds.update(result); return result;
  });
}

export async function releaseBuildClaim(deps: RuntimeImageDeps, build: ImageBuild): Promise<void> {
  await updateClaimedBuild(deps, build, async (_s, current) => {
    const { leaseOwner: _owner, leaseUntil: _until, ...rest } = current;
    return rest;
  });
}
