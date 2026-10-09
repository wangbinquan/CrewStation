import type { ReleaseJourneyEvent, ReleaseJourneySnapshot, ReleaseJourneyStatus, ReleaseJourneyVerification, TrafficSwitchDto } from '@crewstation/contracts';
import { conflict, jsonHash } from '@crewstation/kernel';
import type { Release } from '../release';
import type { SlotState } from '../slots';

export interface ReleaseJourney {
  readonly id: string;
  readonly snapshot: ReleaseJourneySnapshot;
  readonly status: ReleaseJourneyStatus;
  readonly revision: number;
  readonly updatedAt: string;
  readonly targetRevision?: string;
  readonly verification?: ReleaseJourneyVerification;
  readonly verificationIntent?: { requestKey: string; digest: string };
  readonly launch?: { requestKey?: string; digest: string; targetRevision: string; physical: 'blue' | 'green'; operation: TrafficSwitchDto };
}
export type JourneyTransition = Omit<ReleaseJourneyEvent, 'id' | 'journeyId' | 'sequence'>;
export type JourneyPatch = Partial<Pick<ReleaseJourney, 'targetRevision' | 'verification' | 'verificationIntent' | 'launch'>>;
export const journeyTerminal = (journey: ReleaseJourney): boolean => ['succeeded', 'failed', 'interrupted'].includes(journey.status);

/** Stable across readiness polling, different after a new deployment of the same release. */
export function releaseTargetRevision(release: Release, slot: SlotState): string {
  return jsonHash({ releaseId: release.id, commitSha: release.commitSha, physical: slot.physical,
    workload: slot.workload?.revision ?? null, deployStartedAt: release.pipeline.deployStartedAt ?? release.createdAt.toISOString() });
}

export function transitionJourney(journey: ReleaseJourney, event: JourneyTransition, patch: JourneyPatch = {}): ReleaseJourney {
  if (journeyTerminal(journey)) throw conflict('已结束的发布流程不能改写');
  if (event.at < journey.updatedAt) throw conflict('发布流程时间不能倒退');
  let status = journey.status;
  if (event.state === 'failed') status = event.stage === 'complete' ? 'interrupted' : 'failed';
  else if (event.stage === 'complete' && event.state === 'succeeded') {
    if (!journey.launch) throw conflict('发布流程没有已受理的上线操作');
    status = 'succeeded';
  } else if (event.stage === 'ready' && event.state === 'succeeded') status = 'awaiting-verification';
  else if (event.stage === 'verification' && event.state === 'succeeded') {
    if (journey.status !== 'awaiting-verification' || !patch.verification) throw conflict('当前流程不能确认验证');
    status = 'awaiting-confirmation';
  } else if (event.stage === 'launch' && event.state === 'running') status = 'running';
  return { ...journey, ...patch, status, revision: journey.revision + 1, updatedAt: event.at };
}

/** Replayed producer keys must describe the same fact; the original accounting time is retained. */
export function sameJourneyTransition(event: ReleaseJourneyEvent, transition: JourneyTransition): boolean {
  const { id: _id, journeyId: _journeyId, sequence: _sequence, at: _at, ...fact } = event;
  const { at: _newAt, ...candidate } = transition;
  return jsonHash(fact) === jsonHash(candidate);
}
