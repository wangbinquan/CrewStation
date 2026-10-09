import type { ReleaseJourneyKind, ReleaseJourneySource, UserId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { journeyTerminal, releaseTargetRevision } from '../../domain/journey/journey';
import type { ReleaseJourney } from '../../domain/journey/journey';
import type { Release } from '../../domain/release';
import type { RepositoryScope } from '../../ports/unitOfWork';

export async function createJourney(scope: RepositoryScope, release: Release, actorUserId: UserId, kind: ReleaseJourneyKind, source: ReleaseJourneySource, now: Date): Promise<ReleaseJourney> {
  const original = kind === 'publish' ? release.message : (await scope.journeys.byRelease(release.id)).find((journey) => journey.snapshot.kind === 'publish')?.snapshot.message;
  const journey: ReleaseJourney = { id: newResourceId(), snapshot: {
    projectId: release.projectId, serviceId: release.serviceId, releaseId: release.id, kind, source,
    tag: release.tag, commitSha: release.commitSha, branch: release.branch, actorUserId, startedAt: now.toISOString(), ...(original ? { message: original } : {}),
  }, status: 'running', revision: 0, updatedAt: now.toISOString() };
  await scope.journeys.insert(journey);
  await scope.journeys.append(journey.id, { transitionKey: 'accepted', stage: 'prepare', state: 'succeeded', at: now.toISOString(), actorUserId });
  if (kind === 'publish') return scope.journeys.append(journey.id, { transitionKey: 'queued', stage: 'queued', state: 'running', at: now.toISOString() });
  for (const stage of ['build', 'migration'] as const) await scope.journeys.append(journey.id, {
    transitionKey: `${stage}:skipped`, stage, state: 'skipped', at: now.toISOString(), reason: '复用已就绪版本，不执行构建或迁移',
  });
  return (await scope.journeys.get(journey.id))!;
}

/** Called from the same transaction that records the pipeline's actual status transition. */
export async function recordPipelineTransition(scope: RepositoryScope, before: Release, after: Release, now: Date): Promise<void> {
  const id = after.pipeline.journeyId;
  if (!id) return;
  const journey = await scope.journeys.get(id);
  if (!journey || journeyTerminal(journey)) return;
  const stages = { pending: 'queued', building: 'build', migrating: 'migration', deploying: 'deploy', ready: 'ready' } as const;
  const append = (stage: 'queued' | 'build' | 'migration' | 'deploy' | 'ready', state: 'running' | 'succeeded' | 'skipped' | 'failed', reason?: string) =>
    scope.journeys.append(id, { transitionKey: `${stage}:${state}`, stage, state, at: now.toISOString(), ...(reason ? { reason: reason.slice(0, 2000) } : {}) });
  const previous = stages[before.status as keyof typeof stages];
  if (after.status === 'failed') {
    const events = await scope.journeys.events(id), latest = new Map(events.map(event => [event.stage, event]));
    const running = [...latest.values()].filter(event => event.state === 'running').at(-1)?.stage;
    await append(running === 'queued' || running === 'build' || running === 'migration' || running === 'deploy' ? running : previous ?? 'deploy', 'failed', after.message);
    return;
  }
  if (previous && before.status !== after.status) await append(previous, 'succeeded');
  if (after.status === 'migrating' || after.status === 'deploying') {
    if (after.pipeline.runtimeImage && journey.snapshot.kind === 'publish') await append('build', 'skipped', '使用已固定的运行镜像');
    if (after.status === 'deploying' && !after.manifest?.spec.release.migrationCommand && journey.snapshot.kind === 'publish') await append('migration', 'skipped', '此版本没有迁移命令');
  }
  if (after.status === 'ready') {
    const slots = await scope.slots.get(after.serviceId), slot = slots?.[after.targetSlot];
    if (!slot || slot.releaseId !== after.id || slot.state !== 'ready') return;
    const targetRevision = releaseTargetRevision(after, slot);
    await scope.journeys.append(id, { transitionKey: 'ready', stage: 'ready', state: 'succeeded', at: now.toISOString(), targetRevision }, { targetRevision });
  } else {
    const stage = stages[after.status as keyof typeof stages];
    if (stage) await append(stage, 'running');
  }
}

/** Preserve the observation of completed jobs before barriers or deployment prechecks can wait or fail. */
export async function recordPipelinePreparation(scope: RepositoryScope, release: Release, next: 'migration' | 'deploy', now: Date): Promise<void> {
  const id = release.pipeline.journeyId, journey = id ? await scope.journeys.get(id) : undefined;
  if (!id || !journey || journeyTerminal(journey)) return;
  const at = now.toISOString(), events = await scope.journeys.events(id);
  const append = async (stage: 'queued' | 'build' | 'migration' | 'deploy', state: 'running' | 'succeeded' | 'skipped', reason?: string) => {
    if (events.some(event => event.stage === stage && event.state === state)) return;
    await scope.journeys.append(id, { transitionKey: `${stage}:${state}`, stage, state, at, ...(reason ? { reason } : {}) });
  };
  if (release.status === 'pending' || release.status === 'building') {
    await append('queued', 'succeeded');
    await append('build', release.pipeline.runtimeImage ? 'skipped' : 'succeeded', release.pipeline.runtimeImage ? '使用已固定的运行镜像' : undefined);
  }
  if (release.status === 'migrating') await append('migration', 'succeeded');
  await append(next, 'running');
}

export async function interruptReleaseJourneys(scope: RepositoryScope, release: Release, now: Date, reason: string): Promise<void> {
  for (const journey of await scope.journeys.byRelease(release.id)) {
    if (!journeyTerminal(journey)) await scope.journeys.append(journey.id, { transitionKey: 'interrupted', stage: 'complete', state: 'failed', at: now.toISOString(), reason });
  }
}
