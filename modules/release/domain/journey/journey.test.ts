import { expect, test } from 'bun:test';
import type { ReleaseJourneySnapshot } from '@crewstation/contracts';
import { ReleaseJourneySnapshotSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import type { ReleaseJourney } from './journey';
import { transitionJourney } from './journey';

const at = '2026-10-09T02:00:00.000Z';
const snapshot: ReleaseJourneySnapshot = ReleaseJourneySnapshotSchema.parse({ projectId: newResourceId(), serviceId: newResourceId(), releaseId: newResourceId(), kind: 'publish', source: { kind: 'repository' }, tag: 'v1.2.3', commitSha: 'a'.repeat(40), branch: 'main', actorUserId: newResourceId(), startedAt: at });
const base = (): ReleaseJourney => ({ id: newResourceId(), snapshot, revision: 0, status: 'running', updatedAt: at });
test('an accepted operation cannot jump to completion or verification, nor move time backwards', () => {
  expect(() => transitionJourney(base(), { transitionKey: 'done', stage: 'complete', state: 'succeeded', at })).toThrow('没有已受理');
  expect(() => transitionJourney(base(), { transitionKey: 'verify', stage: 'verification', state: 'succeeded', at })).toThrow('不能确认验证');
  expect(() => transitionJourney(base(), { transitionKey: 'old', stage: 'build', state: 'running', at: '2026-10-08T00:00:00.000Z' })).toThrow('倒退');
});
test('readiness waits for a person; interrupted and failed operation results cannot be overwritten', () => {
  const ready = transitionJourney(base(), { transitionKey: 'ready', stage: 'ready', state: 'succeeded', at });
  expect(ready.status).toBe('awaiting-verification');
  for (const status of ['interrupted', 'failed', 'succeeded'] as const) expect(() => transitionJourney({ ...ready, status }, { transitionKey: 'new', stage: 'deploy', state: 'running', at })).toThrow('已结束');
  expect(snapshot.tag).toBe('v1.2.3');
});
