import type { Actor, VerifyReleaseJourneyRequest } from '@crewstation/contracts';
import { ResourceIdSchema, VerifyReleaseJourneyRequestSchema } from '@crewstation/contracts';
import { conflict, jsonHash, notFound } from '@crewstation/kernel';
import { releaseTargetRevision } from '../../domain/journey/journey';
import { standbyOf } from '../../domain/slots';
import { slotRolloutOf } from '../../domain/ledgerProjection';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { releaseProjectWork } from '../projectDeletion';
import { loadSlotDtos } from '../queries';
import { readJourney } from './queries';

export function verifyJourneyUseCase(deps: Pick<ReleaseUseCaseDeps, 'uow' | 'services' | 'authorizer' | 'hosts' | 'clock' | 'admission'>) {
  return async (actor: Actor, id: string, raw: VerifyReleaseJourneyRequest) => {
    ResourceIdSchema.parse(id);
    const input = VerifyReleaseJourneyRequestSchema.parse(raw), original = await deps.uow.read.journeys.get(id);
    if (!original) throw notFound('发布流程', id);
    await deps.authorizer.authorize(actor, original.snapshot.projectId, 'publish');
    await releaseProjectWork(deps, original.snapshot.serviceId, 'slot', id, { actor, input }, async () => {
      const svc = await deps.services.resolveServiceById(original.snapshot.serviceId);
      if (!svc || svc.projectId !== original.snapshot.projectId) throw conflict('发布来源项目已变化');
      await deps.uow.run(async (scope) => {
        const slots = await scope.slots.get(original.snapshot.serviceId), journey = await scope.journeys.get(id);
        if (!journey) throw notFound('发布流程', id);
        const digest = jsonHash({ actorUserId: actor.userId, input });
        if (journey.verificationIntent?.requestKey === input.requestKey) {
          if (journey.verificationIntent.digest !== digest) throw conflict('验证请求键已用于不同内容', { code: 'idempotency_conflict' });
          return;
        }
        if (journey.revision !== input.expectedRevision || journey.status !== 'awaiting-verification' || journey.launch) throw conflict('发布流程已变化，请重新读取后确认验证');
        const release = await scope.releases.getById(journey.snapshot.releaseId), slot = slots?.[standbyOf(slots.active)];
        if (!release || !slots || slot?.releaseId !== input.expectedReleaseId || release.id !== input.expectedReleaseId || release.commitSha !== input.expectedCommitSha
          || releaseTargetRevision(release, slot) !== input.expectedTargetRevision || journey.targetRevision !== input.expectedTargetRevision) throw conflict('待验证版本或部署代次已变化');
        const current = (await loadSlotDtos(scope, slots, svc.slug, deps.hosts)).find((s) => s.name === 'preview');
        if (current?.state !== 'ready' || current.readyReplicas < 1) throw conflict('待验证部署尚未就绪');
        const rollout = slot.workload ? slotRolloutOf(await scope.ledger?.slot(release.serviceId, slot.physical)) : slot;
        if (rollout.state !== 'ready' || rollout.readyReplicas < 1) throw conflict('当前部署代次尚未实际就绪');
        const at = deps.clock.now().toISOString();
        await scope.journeys.append(id, { transitionKey: `verification:${input.requestKey}`, stage: 'verification', state: 'succeeded', at, actorUserId: actor.userId,
          targetRevision: input.expectedTargetRevision, ...(input.note ? { reason: input.note } : {}) }, {
          verification: { actorUserId: actor.userId, at, targetRevision: input.expectedTargetRevision, ...(input.note ? { note: input.note } : {}) }, verificationIntent: { requestKey: input.requestKey, digest },
        });
      });
    });
    return readJourney(deps, actor, id);
  };
}
