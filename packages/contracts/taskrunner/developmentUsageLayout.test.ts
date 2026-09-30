import { expect, test } from 'bun:test';
import { DevelopmentUsageLayoutLookupSchema } from './developmentUsage';
const id = (n: number) => '01a00000-0000-7000-8000-' + String(n).padStart(12, '0');
const selected = { version: 1, executionTaskId: id(3), kind: 'selected', layout: { version: 1 },
  projectId: id(1), workspaceTaskId: id(2), agentId: id(4), profileId: id(5), profileRevision: 3,
  namespace: 'cs-project', podName: 'original-agent', podUid: null, state: 'creating', nativeState: 'queued', renderStart: 1, revision: '2026-09-30T13:00:00.000Z' } as const;
test('layout absence and legacy are explicit and never carry fabricated usage, completion or private fields', () => {
  for (const kind of ['absent', 'legacy'] as const) {
    const value = { version: 1, executionTaskId: id(3), kind } as const;
    expect(DevelopmentUsageLayoutLookupSchema.parse(value)).toEqual(expect.objectContaining(value));
    for (const patch of [{ complete: true }, { persistedThrough: 0 }, { layout: { version: 1 } }, { podUid: null }, { prompt: 'private' }, { runnerTokenHash: 'secret' }, { version: 2 }, { kind: 'unknown' }])
      expect(DevelopmentUsageLayoutLookupSchema.safeParse({ ...value, ...patch }).success).toBe(false);
  }
});
test('selected layout requires all original metadata, safe revisions and explicit nullable instance', () => {
  expect(DevelopmentUsageLayoutLookupSchema.parse(selected)).toEqual(expect.objectContaining(selected));
  expect(DevelopmentUsageLayoutLookupSchema.parse({ ...selected, podUid: 'original-pod' })).toMatchObject({ podUid: 'original-pod' });
  for (const patch of [{ version: 2 }, { layout: { version: 2 } }, { layout: { version: 1, directory: '/work' } }, { executionTaskId: 'invalid' }, { projectId: id(1).toUpperCase() }, { workspaceTaskId: 'invalid' }, { agentId: 'agent-name' }, { profileId: 'profile-name' },
    { profileRevision: 0 }, { profileRevision: Number.MAX_SAFE_INTEGER + 1 }, { namespace: '' }, { podName: '' }, { podUid: '' }, { podUid: undefined }, { state: 'finished' }, { nativeState: 'ended' }, { renderStart: 0 }, { renderStart: 1.5 }, { renderStart: Number.MAX_SAFE_INTEGER + 1 }, { revision: 'not-time' }, { nonce: 'secret' }])
    expect(DevelopmentUsageLayoutLookupSchema.safeParse({ ...selected, ...patch }).success).toBe(false);
});
