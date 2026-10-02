import { describe, expect, test } from 'bun:test';
import { ProjectIdSchema, ServiceIdSchema, TaskIdSchema, TraceIdSchema } from '@crewstation/contracts';
import type { TaskEnvironment } from '../taskEnvironment';
import { assertDevelopmentParentAdmission, developmentParentEpochHash, developmentParentTransitionHash, DevelopmentParentEpochSchema,
  hasDevelopmentParentEnding, readDevelopmentParentEnding, snapshotDevelopmentParentEpoch } from './parentEnding';

const id = '01a0bf5d-8f4b-7c01-8e19-e226732a75a4';
const podUid = '7bffcae3-9d9d-49a2-8e28-60b8e66f1e49', pvcUid = 'd7182072-b80f-4dcb-bc75-f27428cec7e9';
function parent(): TaskEnvironment {
  const at = new Date('2026-10-02T01:00:00Z');
  return { id: TaskIdSchema.parse(id), projectId: ProjectIdSchema.parse(id), serviceId: ServiceIdSchema.parse(id), traceId: TraceIdSchema.parse(id.replaceAll('-', '')),
    kind: 'dev-session', state: 'running', volumeMode: 'persistent', profile: 'original-task', namespace: 'cs-demo', podName: 'original-parent', podUid,
    pvcName: 'original-work', runnerTokenHash: 'a'.repeat(64), connected: true, labels: { a: '1', b: '2' },
    createdAt: at, updatedAt: at, lastActivityAt: at };
}
const render = { image: 'task@sha256:original', workerUid: 10001, resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, start: 4 };
const pointer = { version: 1, endingId: id, epochHash: 'b'.repeat(64), phase: 'children' } as const;
const physical = { podUid, pvcUid };
describe('private immutable original development parent ending', () => {
  test('owner parent without any render keeps authentic null start and invents no start/stop proof', () => {
    const epoch = snapshotDevelopmentParentEpoch(parent(), physical);
    expect(epoch.originalRenderStart).toBeNull(); expect(epoch.acceptedRender).toBeNull();
    expect(epoch).not.toHaveProperty('consumer'); expect(epoch).not.toHaveProperty('stopProof');
    expect(developmentParentEpochHash(epoch)).toMatch(/^[a-f0-9]{64}$/);
  });
  test('ledger parent freezes its real original start; diagnostic deadlines do not alter the epoch', () => {
    const env = { ...parent(), render }, expected = developmentParentEpochHash(snapshotDevelopmentParentEpoch(env, physical));
    expect(snapshotDevelopmentParentEpoch(env, physical).originalRenderStart).toBe(4);
    const changed = { ...env, state: 'failed' as const, connected: false, message: 'waiting', updatedAt: new Date(), lastActivityAt: new Date(),
      render: { ...render, runtimeConnectionDeadline: { generation: 4, at: new Date().toISOString() }, runtimeInitializationDeadline: { generation: 4, at: new Date().toISOString() } } };
    expect(developmentParentEpochHash(snapshotDevelopmentParentEpoch(changed, physical))).toBe(expected);
    expect(developmentParentEpochHash(snapshotDevelopmentParentEpoch({ ...env, labels: { b: '2', a: '1' } }, physical))).toBe(expected);
  });
  test('original hash, Pod, PVC, profile, labels, image and render start change the immutable epoch', () => {
    const env = { ...parent(), render }, expected = developmentParentEpochHash(snapshotDevelopmentParentEpoch(env, physical));
    for (const patch of [{ runnerTokenHash: 'b'.repeat(64) }, { podName: 'replacement' }, { pvcName: 'replacement' }, { profile: 'replacement' },
      { labels: { a: '2', b: '2' } }, { render: { ...render, start: 5 } }, { render: { ...render, image: 'task@sha256:replacement' } }])
      expect(developmentParentEpochHash(snapshotDevelopmentParentEpoch({ ...env, ...patch }, physical))).not.toBe(expected);
    expect(developmentParentEpochHash(snapshotDevelopmentParentEpoch(env, { ...physical, pvcUid: crypto.randomUUID() }))).not.toBe(expected);
    expect(() => snapshotDevelopmentParentEpoch(env, { ...physical, podUid: crypto.randomUUID() })).toThrow();
  });
  test('present malformed render never becomes a legacy null epoch; invalid volume and native child reject', () => {
    for (const value of [null, undefined, false, {}, { ...render, start: 0 }, { ...render, workerUid: 0 }, { ...render, resources: {} }, { ...render, image: '' }, { ...render, workVolume: 'emptyDir' }])
      expect(() => snapshotDevelopmentParentEpoch({ ...parent(), render: value } as unknown as TaskEnvironment, physical)).toThrow();
    expect(() => snapshotDevelopmentParentEpoch({ ...parent(), render: { ...render, rebuild: { id, intent: 'c'.repeat(64), volumeUid: crypto.randomUUID() } } }, physical)).toThrow();
    expect(() => snapshotDevelopmentParentEpoch({ ...parent(), native: {} } as TaskEnvironment, physical)).toThrow();
    expect(() => snapshotDevelopmentParentEpoch(parent(), { ...physical, pvcUid: 'missing' })).toThrow();
    expect(DevelopmentParentEpochSchema.safeParse({ ...snapshotDevelopmentParentEpoch(parent(), physical), originalRenderStart: 1 }).success).toBe(false);
  });
  // RFC-034 foundation P2-01: persisted JSON must enforce the same original render contract as admission.
  test('persisted epoch schema and hash reject malformed present render after JSON recovery', () => {
    const original = snapshotDevelopmentParentEpoch({ ...parent(), render }, physical);
    for (const acceptedRender of [{ start: null }, { start: 4 }, { ...render, image: '' }, { ...render, workerUid: 0 },
      { ...render, resources: {} }, { ...render, resources: { cpu: '1', memory: '2Gi' } }, { ...render, workVolume: 'emptyDir' }]) {
      const persisted = JSON.parse(JSON.stringify({ ...original, acceptedRender, originalRenderStart: acceptedRender.start }));
      expect(DevelopmentParentEpochSchema.safeParse(persisted).success).toBe(false);
      expect(() => developmentParentEpochHash(persisted)).toThrow();
    }
    const recovered = JSON.parse(JSON.stringify(original));
    expect(DevelopmentParentEpochSchema.parse(recovered)).toEqual(original);
    expect(developmentParentEpochHash(recovered)).toBe(developmentParentEpochHash(original));
    const extended = snapshotDevelopmentParentEpoch({ ...parent(), render: { ...render, developmentObjectPlanId: 'original-plan' } }, physical);
    expect(extended.acceptedRender).toHaveProperty('developmentObjectPlanId', 'original-plan');
    expect(developmentParentEpochHash(extended)).not.toBe(developmentParentEpochHash(original));
  });
  test('strict pointer presence closes admission even when malformed or already complete', () => {
    expect(hasDevelopmentParentEnding(parent())).toBe(false); expect(readDevelopmentParentEnding(parent())).toBeUndefined();
    expect(() => assertDevelopmentParentAdmission(parent())).not.toThrow();
    for (const value of [null, undefined, false, {}, pointer, { ...pointer, phase: 'complete' }]) {
      const env = { ...parent(), parentEnding: value };
      expect(hasDevelopmentParentEnding(env)).toBe(true); expect(() => assertDevelopmentParentAdmission(env)).toThrow();
    }
    expect(readDevelopmentParentEnding({ ...parent(), parentEnding: pointer })).toEqual(pointer);
    for (const value of [null, undefined, false, { ...pointer, extra: true }, { ...pointer, epochHash: 'bad' }, { ...pointer, phase: 'unknown' }])
      expect(() => readDevelopmentParentEnding({ ...parent(), parentEnding: value })).toThrow();
  });
  test('final transition hash follows real completion state and token but ignores activity and deadlines', () => {
    const env = { ...parent(), render, parentEnding: { ...pointer, phase: 'complete' } }, expected = developmentParentTransitionHash(env);
    expect(developmentParentTransitionHash({ ...env, connected: false, message: 'later Runner diagnostic', updatedAt: new Date(),
      render: { ...render, runtimeConnectionDeadline: { generation: 4, at: new Date().toISOString() } } })).toBe(expected);
    for (const patch of [{ state: 'failed' as const }, { runnerTokenHash: 'c'.repeat(64) }, { rebuildId: id }, { parentEnding: pointer }])
      expect(developmentParentTransitionHash({ ...env, ...patch })).not.toBe(expected);
  });
});
