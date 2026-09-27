import type { ImageValidation } from '../../domain/records';
import type { RepositoryScope } from '../../ports/unitOfWork';
import type { RuntimeImageDeps } from '../dependencies';

const active = (value: ImageValidation) => ['queued', 'running', 'cancelling'].includes(value.state);
export async function claimValidation(deps: RuntimeImageDeps, id: string, owner: string) {
  return deps.uow.run(async (s) => {
    const current = await s.validations.get(id, true), now = deps.clock.now();
    if (!current || !active(current) || (current.leaseUntil && current.leaseUntil > now.toISOString())) return undefined;
    const next = { ...current, epoch: current.epoch + 1, leaseOwner: owner, leaseUntil: new Date(now.getTime() + 60000).toISOString() };
    await s.validations.update(next); return next;
  });
}
export async function updateClaimedValidation(deps: RuntimeImageDeps, claim: ImageValidation, update: (scope: RepositoryScope, current: ImageValidation) => Promise<ImageValidation>) {
  return deps.uow.run(async (s) => {
    const current = await s.validations.get(claim.id, true), now = deps.clock.now().toISOString();
    if (!current || !active(current) || current.epoch !== claim.epoch || current.leaseOwner !== claim.leaseOwner || !current.leaseUntil || current.leaseUntil <= now) return undefined;
    const next = await update(s, current); await s.validations.update(next); return next;
  });
}
