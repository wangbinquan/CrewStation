import type { Actor, TrafficSwitchDto, TrafficSwitchRequest } from '@crewstation/contracts';
import { conflict, jsonHash } from '@crewstation/kernel';
import { journeyTerminal, releaseTargetRevision } from '../../domain/journey/journey';
import type { ReleaseJourney } from '../../domain/journey/journey';
import type { Release } from '../../domain/release';
import type { ServiceSlots } from '../../domain/slots';
import { standbyOf } from '../../domain/slots';
import type { RepositoryScope } from '../../ports/unitOfWork';
import { createJourney } from './recording';
import { handoffSwitchDto } from '../../domain/executionHandoff';
import { slotRolloutOf } from '../../domain/ledgerProjection';

export async function replayJourneyLaunch(scope: RepositoryScope, serviceId: Release['serviceId'], input: TrafficSwitchRequest): Promise<TrafficSwitchDto | undefined> {
  if (!input.requestKey) return undefined;
  const prior = await scope.journeys.bySwitchKey(serviceId, input.requestKey);
  if (!prior?.launch) return undefined;
  if (prior.launch.digest !== jsonHash(input)) throw conflict('上线请求键已用于不同目标或内容', { code: 'idempotency_conflict' });
  if (prior.launch.operation.handoff) { const handoff = await scope.handoffs.get(prior.launch.operation.id); if (handoff) return handoffSwitchDto(handoff); }
  return prior.launch.operation;
}

/** Called under the original service-slot lock; explicit wizard requests bind verification to this deployment. */
export async function journeyForLaunch(scope: RepositoryScope, actor: Actor, input: TrafficSwitchRequest, release: Release, current: Release | undefined, slots: ServiceSlots, now: Date): Promise<ReleaseJourney> {
  const targetRevision = releaseTargetRevision(release, slots[standbyOf(slots.active)]);
  if (input.expectedTargetRevision && input.expectedTargetRevision !== targetRevision) throw conflict('待上线部署代次已变化，请重新验证');
  if (input.journeyId) {
    const slot = slots[standbyOf(slots.active)], rollout = slot.workload ? slotRolloutOf(await scope.ledger?.slot(release.serviceId, slot.physical)) : slot;
    if (rollout.state !== 'ready' || rollout.readyReplicas < 1) throw conflict('待上线部署尚未实际就绪');
    const journey = await scope.journeys.get(input.journeyId);
    if (!journey || journey.snapshot.serviceId !== release.serviceId || journey.snapshot.projectId !== release.projectId || journey.snapshot.releaseId !== release.id) throw conflict('发布流程不属于当前服务或目标版本');
    if (!input.requestKey || !input.expectedTargetRevision || !input.expectedTargetRelease || input.expectedActiveRelease === undefined) throw conflict('向导上线需要完整的原确认目标');
    if (journey.targetRevision !== targetRevision || journey.verification?.targetRevision !== targetRevision || journey.status !== 'awaiting-confirmation' || journey.launch) throw conflict('当前部署尚未完成验证或流程已结束');
    return journey;
  }
  const matches = (await scope.journeys.byRelease(release.id)).filter((journey) => !journeyTerminal(journey) && !journey.launch && journey.targetRevision === targetRevision);
  if (matches.length === 1) return matches[0]!;
  return createJourney(scope, release, actor.userId, current && release.createdAt < current.createdAt ? 'rollback' : 'promote', { kind: 'external' }, now);
}

export async function recordJourneyLaunch(scope: RepositoryScope, journey: ReleaseJourney, input: TrafficSwitchRequest, operation: TrafficSwitchDto, release: Release, slots: ServiceSlots, now: Date): Promise<TrafficSwitchDto> {
  const physical = standbyOf(slots.active), targetRevision = releaseTargetRevision(release, slots[physical]);
  const dto = { ...operation, journeyId: journey.id }, at = now.toISOString();
  if (!journey.verification) await scope.journeys.append(journey.id, { transitionKey: 'verification:unrecorded', stage: 'verification', state: 'unknown', at, reason: '此上线操作没有人工验证记录' });
  await scope.journeys.append(journey.id, { transitionKey: `launch:${operation.id}`, stage: 'launch', state: 'running', at,
    actorUserId: operation.actorUserId, targetRevision, trafficSwitchId: operation.id, ...(operation.handoff ? { handoffId: operation.id } : {}) }, {
    targetRevision, launch: { ...(input.requestKey ? { requestKey: input.requestKey } : {}), digest: jsonHash(input), targetRevision, physical, operation: dto },
  });
  const stage = operation.handoff ? 'freeze' : 'route';
  await scope.journeys.append(journey.id, { transitionKey: `${stage}:running`, stage, state: 'running', at, trafficSwitchId: operation.id });
  return dto;
}
