import { expect, test } from 'bun:test';
import { ProjectDeletionContextSchema, TaskIdSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import { runtimeProjectStops } from './runtimeStops';

function fixture(unscheduled = false) {
  const environment = { id: TaskIdSchema.parse(newResourceId()), namespace: 'cs-original', podName: 'original-pod', podUid: crypto.randomUUID() };
  const key = JSON.stringify({ apiVersion: 'v1', kind: 'Pod', namespace: environment.namespace, name: environment.podName });
  const nodeUid = unscheduled ? null : crypto.randomUUID();
  const context = ProjectDeletionContextSchema.parse({ operationId: newResourceId(), generation: 1, phase: 'stop',
    target: { id: newResourceId(), serviceId: newResourceId(), slug: 'original', name: 'Original', namespace: environment.namespace, kind: 'DigitalWorker', state: 'deleting', revision: '1',
      prodHost: 'original.invalid', previewHost: 'preview.original.invalid', serviceHost: 'original.service.invalid' },
    confirmed: { participant: 'task-runtime', complete: true, resources: [], references: [], blockers: [], revision: jsonHash('runtime') } });
  const resources = ProjectDeletionContextSchema.parse({ ...context, confirmed: { ...context.confirmed, participant: 'resources',
    resources: [{ kind: 'protected:Pod', id: key, identity: JSON.stringify({ uid: environment.podUid, nodeUid, nodeName: unscheduled ? null : 'original-node', specDigest: jsonHash('original-full-spec') }), count: 1 }] } });
  const dev = ProjectDeletionContextSchema.parse({ ...context, confirmed: { ...context.confirmed, participant: 'dev-session' } });
  let proof: { key: string; uid: string; nodeUid: string | null; digest: string; observedAt: string } | undefined, valid = true, calls = 0;
  const ports = runtimeProjectStops({ projectDeletionParticipantContext: async (actual, participant) => {
    expect(actual).toEqual(context); return participant === 'resources' ? resources : dev;
  }, assertProjectDeletionGrant: async () => { if (!valid) throw precondition('controlled Root grant expired'); } }, async (grant, selected: string) => {
    expect(grant).toEqual(dev); return selected;
  }, { get: async (grant, actualKey, uid) => { calls++; expect(grant).toEqual(resources); expect(actualKey).toBe(key); expect(uid).toBe(environment.podUid); return proof; } }, async () => ({ kind: 'ready' }),
  { get: async () => { throw new Error('A live confirmed Pod cannot borrow a historical receipt'); } });
  const receipt = { key, uid: environment.podUid, nodeUid, digest: jsonHash('independent actual complete Pod receipt'), observedAt: new Date().toISOString() };
  return { ports, context, resources, environment, receipt, setProof: (value: typeof proof) => { proof = value; }, expire: () => { valid = false; }, calls: () => calls };
}
test('uses the actual protected Pod confirmation and its original resource grant, including a proved never-scheduled Pod', async () => {
  for (const unscheduled of [false, true]) {
    const f = fixture(unscheduled);
    expect(await f.ports.stopped(f.context, f.environment)).toBeUndefined();
    f.setProof(f.receipt);
    expect(await f.ports.stopped(f.context, f.environment)).toEqual({ digest: f.receipt.digest });
    expect(await f.ports.development(f.context).advance('original-selection')).toBe('original-selection');
  }
});
test('a replacement environment UID or an unrelated node receipt cannot authorize original STOP', async () => {
  const f = fixture(); f.setProof(f.receipt);
  await expect(f.ports.stopped(f.context, { ...f.environment, podUid: crypto.randomUUID() })).rejects.toMatchObject({ kind: 'precondition' });
  expect(f.calls()).toBe(0);
  f.setProof({ ...f.receipt, nodeUid: crypto.randomUUID() });
  await expect(f.ports.stopped(f.context, f.environment)).rejects.toMatchObject({ kind: 'precondition' });
  f.setProof(f.receipt); f.expire();
  await expect(f.ports.stopped(f.context, f.environment)).rejects.toMatchObject({ kind: 'precondition' });
});
