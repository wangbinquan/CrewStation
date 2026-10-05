import { expect, test } from 'bun:test';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { projectDeletionGrantRouter } from './projectDeletionGrants';

test('only authenticated, complete SCM stop/purge contexts reach the persistent grant owner; invalidation rejects replay', async () => {
  const token = 'private-native-grant'.padEnd(48, '0'); let valid = true, checks = 0;
  const router = projectDeletionGrantRouter({ token, assertGrant: async () => { checks++; if (!valid) throw Error('original lease expired'); } });
  const grant = { operationId: newResourceId(), generation: 1, phase: 'stop', target: { id: newResourceId(), name: 'Original', slug: 'original', namespace: 'cs-original',
    kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'original.example', previewHost: 'preview.original.example', serviceHost: 'original.service.example' },
    confirmed: { participant: 'scm', complete: true, revision: jsonHash('confirmed'), resources: [], blockers: [], references: [] } };
  const call = (body: unknown, credential = token) => router.request('/internal/project-deletion/grant', { method: 'POST', headers: { authorization: 'Bearer ' + credential }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  expect((await call(grant, 'wrong')).status).toBe(401); expect(checks).toBe(0);
  expect((await call(grant)).status).toBe(204); expect(checks).toBe(1);
  expect((await call({ ...grant, phase: 'purge' })).status).toBe(204);
  expect((await call({ ...grant, phase: 'metadata' })).status).toBe(403);
  expect((await call({ ...grant, confirmed: { ...grant.confirmed, complete: false } })).status).toBe(403);
  expect((await call({ ...grant, hidden: 'caller secret' })).status).toBe(403);
  expect((await call('{}')).status).toBe(403); expect((await call('x'.repeat(8_388_609))).status).toBe(403);
  valid = false; expect((await call(grant)).status).toBe(403); expect(checks).toBe(3);
  expect(() => projectDeletionGrantRouter({ token: 'short', assertGrant: async () => {} })).toThrow();
});
test('registry owners may revalidate only their persisted purge phase, never mint a token-only or metadata destruction grant', async () => {
  const token = 'private-original-registry-grant'.padEnd(48, '0'); let valid = true, checks = 0;
  const router = projectDeletionGrantRouter({ token, assertGrant: async () => { checks++; if (!valid) throw Error('actual persisted permit revoked'); } });
  const target = { id: newResourceId(), name: 'Original', slug: 'original', namespace: 'cs-original', kind: 'DigitalWorker', state: 'deleting', revision: '1', prodHost: 'original.invalid', previewHost: 'preview.original.invalid', serviceHost: 'original.service.invalid' };
  const call = (body: unknown) => router.request('/internal/project-deletion/grant', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  for (const participant of ['release', 'runtime-environment']) {
    const context = { operationId: newResourceId(), generation: 1, phase: 'purge', target, confirmed: { participant, complete: true, revision: jsonHash(participant), resources: [], blockers: [], references: [] } };
    expect((await call(context)).status).toBe(204);
    for (const phase of ['seal', 'stop', 'namespace', 'metadata', 'verify']) expect((await call({ ...context, phase })).status).toBe(403);
    valid = false; expect((await call(context)).status).toBe(403); valid = true;
  }
  expect(checks).toBe(4);
});
