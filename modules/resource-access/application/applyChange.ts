import type { UserId } from '@crewstation/contracts';
import { isPlatformError, precondition } from '@crewstation/kernel';
import type { ResourceChange } from '../domain/change';
import type { ResourceAccessDeps } from './dependencies';
import { activeProject, adapterOf, requireAdmin, requestable, validateValues } from './access';

/** Queue lease + version CAS fence each persisted transition. A receipt resumes observation without writing again. */
export async function applyResourceChange(deps: ResourceAccessDeps, id: string, heartbeat: () => Promise<boolean>): Promise<boolean> {
  const change = await deps.repository.get(id);
  if (!change || !['approved', 'applying'].includes(change.state)) return true;
  return deps.repository.withAdmission(change.projectId, () => applyAcceptedChange(deps, change, heartbeat), id);
}

async function applyAcceptedChange(deps: ResourceAccessDeps, change: ResourceChange, heartbeat: () => Promise<boolean>): Promise<boolean> {
  const id = change.id;
  const adapter = adapterOf(deps, change.target);
  const save = async (patch: Partial<ResourceChange>) => {
    if (!await heartbeat()) throw precondition('申请应用租约已转移');
    const next = { ...change!, ...patch, version: change!.version + 1, updatedAt: deps.clock.now().toISOString() };
    if (!await deps.repository.save(next, change!.version)) throw precondition('申请状态已被接管');
    change = next;
  };
  try {
    if (!change.receipt && adapter.recover) { const recovered = await adapter.recover(change.projectId, id); if (recovered) await save({ receipt: recovered, effect: recovered.effect, state: 'applying' }); }
    if (!change.receipt) {
      const actor = { userId: change.decidedBy as UserId, isAdmin: true };
      await requireAdmin(deps, actor); await activeProject(deps, actor, change.projectId);
      const view = await adapter.read(change.projectId, change.target);
      if (change.origin === 'owner-request') {
        const role = await deps.projects.authorize({ userId: change.requestedBy, isAdmin: false }, change.projectId, 'request-resources');
        if (role !== 'owner' || !await requestable(deps, view)) throw precondition('申请人资格或可申请目录已变化，请重新审查');
      }
      validateValues(view, change.approvedValues!);
      await save({ state: 'applying', attempt: change.attempt + 1, failure: null });
      if (!await heartbeat()) return true;
      const receipt = await adapter.apply({ operationId: id, actor, projectId: change.projectId, target: change.target, expectedRevision: change.approvedRevision!, values: change.approvedValues!, requestedBy: change.requestedBy, reason: change.reason });
      await save({ receipt, effect: receipt.effect });
    }
    const receipt = change.receipt!;
    const observation = receipt.applied ? receipt : adapter.observe ? await adapter.observe(change.projectId, change.target, receipt, id) : { applied: false, effect: receipt.effect };
    if (observation.applied) { await save({ state: 'applied', appliedAt: deps.clock.now().toISOString(), effect: observation.effect, failure: null }); return true; }
    if (observation.effect !== change.effect) await save({ effect: observation.effect });
    return false;
  } catch (error) {
    if (!await heartbeat()) return true;
    // A stale CAS also means a newer approval/retry owns the record. Never overwrite it with an old failure.
    if ((await deps.repository.get(id))?.version !== change.version) return true;
    const stale = isPlatformError(error) && (error.kind === 'conflict' || error.kind === 'forbidden' || error.kind === 'precondition') && !change.receipt;
    await save({ state: stale ? 'needs-review' : 'apply-failed', failure: error instanceof Error ? error.message : String(error) });
    return true;
  }
}
