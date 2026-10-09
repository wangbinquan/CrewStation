import { describe, expect, test } from 'bun:test';
import type { ReleaseJourneyEvent } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { journeyStages } from './projection';

const at = '2026-10-09T01:00:00.000Z';
const event = (input: Partial<ReleaseJourneyEvent>): ReleaseJourneyEvent => ({ id: newResourceId(), journeyId: newResourceId(), sequence: 1, transitionKey: 'build', stage: 'build', state: 'running', at, ...input });
describe('release journey stage evidence', () => {
  test('missing start never acquires a synthetic duration; other stages stay unknown for legacy', () => {
    const view = journeyStages([event({ stage: 'ready', state: 'succeeded' })], true);
    expect(view.find((s) => s.stage === 'ready')).toEqual({ stage: 'ready', state: 'succeeded', finishedAt: at });
    expect(view.find((s) => s.stage === 'build')).toEqual({ stage: 'build', state: 'unknown' });
    expect(view.every((s) => s.durationMs === undefined)).toBe(true);
  });
  test('durations use only recorded nonnegative running/end pairs, skips retain a reason', () => {
    const view = journeyStages([event({}), event({ state: 'succeeded', at: '2026-10-09T01:00:03.000Z' }), event({ stage: 'migration', state: 'skipped', reason: '没有迁移命令' })]);
    expect(view.find((s) => s.stage === 'build')?.durationMs).toBe(3000);
    expect(view.find((s) => s.stage === 'migration')).toMatchObject({ state: 'skipped', reason: '没有迁移命令' });
    expect(view.find((s) => s.stage === 'migration')?.durationMs).toBeUndefined();
    expect(journeyStages([event({}), event({ state: 'failed', at: '2026-10-09T00:00:00.000Z' })])[2]?.durationMs).toBeUndefined();
  });
});
