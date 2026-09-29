// RFC-034: raw CS/AW fixture locks the explicitly negotiated proof contract.
import { expect, test } from 'bun:test';
import fixture from '../../tests/fixtures/crewstation-native-capture-v2.json';
import { ExecutionObservationPageSchema, ExecutionObservationSchema } from './executionObservations';
import { ExecutionCaptureObservationSchema, ExecutionObservationV2PageSchema } from './executionObservationSync';

function page() {
  return { schemaVersion: 2, capability: 'executionObservationsV2', mode: 'snapshot',
    projectId: fixture.identity.projectId, taskId: fixture.identity.taskId, items: [fixture],
    nextCursor: null, persistedThrough: 'through', firstAvailableCursor: 'first', asOf: fixture.observedAt,
    visibilityRevision: 0, costVisibility: 'hidden', gaps: [], snapshotId: 'v2:snapshot', snapshotThrough: 'through', expiresAt: fixture.observedAt };
}
test('raw v2 capture fixture round-trips and neither v1 records nor v1 pages accept it', () => {
  expect(ExecutionCaptureObservationSchema.parse(fixture) as unknown).toEqual(fixture);
  expect(ExecutionObservationV2PageSchema.parse(page()) as unknown).toEqual(page());
  expect(ExecutionObservationSchema.safeParse(fixture).success).toBe(false);
  expect(ExecutionObservationPageSchema.safeParse({ ...page(), schemaVersion: 1, capability: 'executionObservationsV1' }).success).toBe(false);
  expect(ExecutionObservationV2PageSchema.safeParse({ ...page(), schemaVersion: 3 }).success).toBe(false);
});
test('proof envelope, task identity, revision and frozen watermarks cannot drift', () => {
  for (const patch of [{ sourceId: 'other' }, { recordId: 'other' }, { revision: 0 }, { occurredAt: fixture.observedAt },
    { observedAt: '2026-09-29T00:00:00.000Z' }, { identity: { ...fixture.identity, executionGeneration: 3 } }])
    expect(ExecutionCaptureObservationSchema.safeParse({ ...fixture, ...patch }).success).toBe(false);
  expect(ExecutionObservationV2PageSchema.safeParse({ ...page(), taskId: fixture.identity.executionId }).success).toBe(false);
  expect(ExecutionObservationV2PageSchema.safeParse({ ...page(), snapshotThrough: 'different' }).success).toBe(false);
  expect(ExecutionCaptureObservationSchema.safeParse({ ...fixture, capture: { ...fixture.capture, proof: { ...fixture.capture.proof, steps: 1 } } }).success).toBe(false);
});
