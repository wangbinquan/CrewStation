import { jsonHash } from '@crewstation/kernel';
import { journeyTerminal, releaseTargetRevision } from '../../domain/journey/journey';
import type { ReleaseJourney } from '../../domain/journey/journey';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { releaseProjectWork } from '../projectDeletion';
import { loadSlotDtos } from '../queries';
import { slotRolloutOf } from '../../domain/ledgerProjection';

type Deps = Pick<ReleaseUseCaseDeps, 'uow' | 'services' | 'clock' | 'executionHandoff' | 'admission' | 'hosts' | 'logger'>;
async function observe(deps: Deps, candidate: ReleaseJourney): Promise<boolean> {
  const { serviceId, releaseId, projectId, commitSha } = candidate.snapshot, launch = candidate.launch;
  if (!launch || !deps.executionHandoff) return false;
  const svc = await deps.services.resolveServiceById(serviceId);
  if (svc?.projectId !== projectId) return false;
  if (!await deps.executionHandoff.observeRoute(serviceId, releaseId, launch.physical)) return false;
  return deps.uow.run(async (scope) => {
    const slots = await scope.slots.get(serviceId), journey = await scope.journeys.get(candidate.id), release = await scope.releases.getById(releaseId);
    if (!journey || journeyTerminal(journey) || !slots || !release || !journey.launch) return false;
    const slot = slots[slots.active];
    if (slots.active !== launch.physical || slot.releaseId !== releaseId || release.commitSha !== commitSha || releaseTargetRevision(release, slot) !== launch.targetRevision) return false;
    const current = (await loadSlotDtos(scope, slots, svc.slug, deps.hosts)).find((value) => value.name === 'prod');
    if (current?.state !== 'ready' || current.readyReplicas < 1) return false;
    const rollout = slot.workload ? slotRolloutOf(await scope.ledger?.slot(serviceId, slot.physical)) : slot;
    if (rollout.state !== 'ready' || rollout.readyReplicas < 1) return false;
    if (launch.operation.handoff && (await scope.handoffs.get(launch.operation.id))?.stage !== 'complete') return false;
    const at = deps.clock.now().toISOString(), fact = { at, trafficSwitchId: launch.operation.id, targetRevision: launch.targetRevision };
    const previousId = launch.operation.previousReleaseId;
    if (previousId && previousId !== releaseId) for (const previous of await scope.journeys.byRelease(previousId)) {
      if (previous.launch && !journeyTerminal(previous)) await scope.journeys.append(previous.id, { transitionKey: 'superseded-launch', stage: 'complete', state: 'failed', at, reason: '后续上线已实际生效，原流程未完成生效确认' });
    }
    if (!launch.operation.handoff) await scope.journeys.append(journey.id, { ...fact, transitionKey: 'route:observed', stage: 'route', state: 'succeeded' });
    await scope.journeys.append(journey.id, { ...fact, transitionKey: 'launch:complete', stage: 'launch', state: 'succeeded' });
    await scope.journeys.append(journey.id, { ...fact, transitionKey: 'complete', stage: 'complete', state: 'succeeded' });
    return true;
  });
}

/** Bounded, admitted background observation. GET never writes or implicitly confirms launch. */
export function journeyObserver(deps: Deps): () => Promise<number> {
  let afterId: string | undefined, inFlight: Promise<number> | undefined;
  const scan = async () => {
    const candidates = await deps.uow.read.journeys.pendingLaunches(20, afterId);
    afterId = candidates.length === 20 ? candidates.at(-1)!.id : undefined;
    let count = 0;
    for (const candidate of candidates) {
      try {
        const done = await releaseProjectWork(deps, candidate.snapshot.serviceId, 'handoff', candidate.id, { journeyId: candidate.id, revision: jsonHash(candidate) }, () => observe(deps, candidate));
        if (done) count++;
      } catch (error) { deps.logger.warn('release journey observation pending', { journeyId: candidate.id, error: String(error) }); }
    }
    return count;
  };
  return () => { inFlight ??= scan().finally(() => { inFlight = undefined; }); return inFlight; };
}
