import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { ProjectDeletionContextSchema } from '../../../packages/contracts';
import { jsonHash, newResourceId } from '../../../packages/kernel';
import { createRegistryReclamationClient, nativeRegistryWriterAdmission, registryHistoryIdentity } from '../../../packages/filesystem-metrics';
import { observeFileConsumers } from '../../../packages/filesystem-metrics/consumers';
import { consumerFixture } from '../../../packages/filesystem-metrics/consumerFixture';
import { registryArtifactFixture } from '../../../modules/platform/adapters/k8s/nativeRegistry/artifactFixture';
import { nativeRegistryService } from './service';
import { nativeRegistryJournal } from './journal';
import { captureRegistryNativeInstallation, RegistryNativeOriginSchema, registryNativeSourceValidator } from './source';

async function fixture(proc: { root: string; process(id: string): Promise<string> }, participant: 'release' | 'runtime-environment' = 'release') {
  await writeFile(join(proc.root, 'sys/kernel/random/boot_id'), randomUUID() + '\n'); await proc.process('101');
  const f = await registryArtifactFixture(proc.root), history = await f.source.capture(newResourceId(), f.query);
  const installation = await captureRegistryNativeInstallation(f.k8s, { namespace: 'system', service: 'registry', pod: 'registry', pvc: 'registry', pv: 'registry', probe: 'probe', container: 'registry', root: f.root,
    origin: RegistryNativeOriginSchema.parse(history.origin) }, AbortSignal.timeout(5000));
  const inspectSource = registryNativeSourceValidator(f.k8s, installation);
  const originalFiles = [...history.original.entries.filter(row => row.kind === 'file'), ...history.original.blobs]
    .map(({ device, inode, birthtimeNs }) => ({ device, inode, birthtimeNs }));
  const context = ProjectDeletionContextSchema.parse({ operationId: newResourceId(), generation: 1, phase: 'purge',
    target: { id: history.projectId, name: 'Original', slug: 'original', namespace: 'cs-original', kind: 'DigitalWorker', state: 'deleting', revision: '1', prodHost: 'original.invalid', previewHost: 'preview.original.invalid', serviceHost: 'original.service.invalid' },
    confirmed: { participant, complete: true, revision: jsonHash('original confirmed plan'), blockers: [], references: [], resources: [{
      kind: participant === 'release' ? 'release-native:artifact' : 'runtime-native:artifact', id: 'registry-history:' + history.projectId, identity: registryHistoryIdentity(history),
      sourceIdentity: participant === 'release' ? history.sourceIdentity : jsonHash({ nativeSource: history.sourceIdentity, consumerId: null, consumerIdentity: null }), scope: 'physical', count: history.original.entries.length + history.original.blobs.length,
    }] } });
  const token = 'native-registry-source-token-12345678901234567890'; let valid = true, closed = true, checks = 0, originalChecks = 0;
  const journal = nativeRegistryJournal(join(f.root, 'native-journal.sqlite'), history.sourceIdentity);
  const handler = nativeRegistryService({ root: f.root, token, sourceIdentity: history.sourceIdentity, journal,
    assertGrant: async actual => { checks++; if (!valid || jsonHash(actual) !== jsonHash(context)) throw Error('revoked or substituted original operation'); },
    // Match the actual host's pinned installation check; the native eraser
    // reads the byte graph and the final assertion uses the independent source.
    assertOriginalSource: async (original, signal) => {
      originalChecks++; await inspectSource(original, signal);
      const report = await observeFileConsumers(originalFiles, proc.root, signal);
      if (!report.complete || report.blockers.length || report.bootId !== history.consumers.bootId || report.namespace !== history.consumers.namespace || report.consumers.length) throw Error('actual old consumers or changed source remain');
    },
    authority: () => ({ exclusive: async (_original, work) => { if (!closed) throw Error('actual writers remain'); return work(); }, assertClosed: async () => { if (!closed) throw Error('actual writers remain'); } }) });
  const request = (body: unknown = { context, history }, credential = token, method = 'POST') => handler(new Request('http://native/native/registry/reclaim', { method, headers: { authorization: 'Bearer ' + credential }, body: JSON.stringify(body) }));
  const client = createRegistryReclamationClient({ baseUrl: 'http://native/', token, fetch: (url, init) => handler(new Request(url, init)) });
  const gate = (journalIdentity = journal.identity) => handler(new Request('http://native/native/registry/writer-admission', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({ sourceIdentity: history.sourceIdentity, journalIdentity }) }));
  const writers = nativeRegistryWriterAdmission({ baseUrl: 'http://native/', token, journalIdentity: journal.identity, sourceIdentity: journal.sourceIdentity, fetch: (url, init) => handler(new Request(url, init)) });
  return { ...f, handler, client, context, history, journal, gate, writers, request, revoke: () => { valid = false; }, renew: () => { valid = true; }, open: () => { closed = false; }, close: () => { closed = true; }, counts: () => ({ checks, originalChecks }), drop: async () => { journal.close(); await f.drop(); } };
}
test('private native service binds source, owner material and original phase before grant inspection; bad token and caller actor cannot access destruction', async () => {
  await consumerFixture(async proc => {
    const f = await fixture(proc); try {
      expect((await f.request(undefined, 'wrong')).status).toBe(401); expect(f.counts().checks).toBe(0);
      expect((await f.request({ context: f.context, history: f.history, actor: { isAdmin: true } })).status).toBe(403);
      expect((await f.request({ context: { ...f.context, phase: 'metadata' }, history: f.history })).status).toBe(403);
      expect((await f.request({ context: { ...f.context, target: { ...f.context.target, id: newResourceId() } }, history: f.history })).status).toBe(403);
      expect((await f.request({ context: { ...f.context, confirmed: { ...f.context.confirmed, resources: [] } }, history: f.history })).status).toBe(403);
      expect(f.counts().checks).toBe(0); expect(await readFile(f.path(f.layer), 'utf8')).toBe('original project layer');
      f.revoke(); expect((await f.request()).status).toBe(403); expect(f.counts()).toEqual({ checks: 1, originalChecks: 0 });
    } finally { await f.drop(); }
  });
});
test('actual durable native journal blocks writer admission through interruption and reopening', async () => {
  await consumerFixture(async proc => {
    const f = await fixture(proc); try {
      expect((await f.gate()).status).toBe(204);
      await f.writers.assertAvailable(); expect(await f.writers.observe()).toMatchObject({ complete: true, active: 0 });
      expect((await f.gate(jsonHash('replacement journal'))).status).toBe(403);
      const callback = f.journal.begin(f.context, f.history);
      expect((await f.gate()).status).toBe(409);
      await expect(f.writers.assertAvailable()).rejects.toThrow('not released');
      callback.finish(); expect((await f.gate()).status).toBe(204);
      expect(f.journal.status()).toMatchObject({ active: 0, total: 1 });
    } finally { await f.drop(); }
  });
});
test.skipIf(process.platform !== 'linux')('actual private service/client and Linux native erasure keep acknowledgements distinct from independent final completion for both original owners', async () => {
  for (const participant of ['release', 'runtime-environment'] as const) await consumerFixture(async proc => {
    const f = await fixture(proc, participant); try {
      const result = await f.client.reclaim(f.context, f.history);
      expect(result).toMatchObject({ kind: 'acknowledged', historyIdentity: registryHistoryIdentity(f.history), remainingEntries: 0, remainingExclusiveBlobs: 0, physicalReclamationProven: false });
      const independent = await f.source.inspect(f.history);
      expect(independent).toMatchObject({ native: 0, storage: 0, consumerCount: 0, independent: true, physicalReclamationProven: false });
      expect(f.counts().checks).toBeGreaterThan(10); expect(f.counts().originalChecks).toBeGreaterThan(10);
    } finally { await f.drop(); }
  });
});
test('private service rechecks the complete original installation before entering native erasure', async () => {
  await consumerFixture(async proc => {
    const f = await fixture(proc); try {
      await f.k8s.apply({ apiVersion: 'v1', kind: 'Service', metadata: { name: 'registry', namespace: 'system', uid: f.ids.service }, spec: { selector: { app: 'another-original' }, ports: [{ port: 5000 }] } });
      expect((await f.request()).status).toBe(403);
      expect(f.counts().originalChecks).toBe(1);
      expect(f.journal.status()).toMatchObject({ active: 0, total: 0 });
      expect(await readFile(f.path(f.layer), 'utf8')).toBe('original project layer');
    } finally { await f.drop(); }
  });
});
test.skipIf(process.platform !== 'linux')('source exclusion and renewed controller authority stop native mutation; the same original scope can retry after exclusion is proved', async () => {
  await consumerFixture(async proc => {
    const f = await fixture(proc); try {
      f.open(); expect((await f.request()).status).toBe(403);
      expect(await readFile(f.path(f.layer), 'utf8')).toBe('original project layer');
      f.revoke(); await expect(f.client.reclaim(f.context, f.history)).rejects.toThrow('rejected');
      expect(await readFile(f.path(f.layer), 'utf8')).toBe('original project layer');
      f.renew(); f.close(); expect((await f.client.reclaim(f.context, f.history)).remainingExclusiveBlobs).toBe(0);
    } finally { await f.drop(); }
  });
});
test.skipIf(process.platform !== 'linux')('a rejected SQL authority cannot clear the native journal while its original callback still runs', async () => {
  await consumerFixture(async proc => {
    const f = await fixture(proc), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), lost = Promise.withResolvers<never>();
    let callback: Promise<unknown> | undefined, valid = true;
    const token = 'original-native-loss-token-12345678901234567890';
    const handler = nativeRegistryService({ root: f.root, token, sourceIdentity: f.history.sourceIdentity, journal: f.journal,
      assertGrant: async context => { if (!valid || jsonHash(context) !== jsonHash(f.context)) throw Error('original grant was revoked'); },
      assertOriginalSource: async history => { await f.source.inspect(history); },
      authority: () => ({ exclusive: async (_original, work) => {
        const pending = work(); callback = pending; void pending.catch(() => {}); return Promise.race([pending, lost.promise]);
      }, assertClosed: async () => { entered.resolve(); await release.promise; } }) });
    const pending = handler(new Request('http://native/native/registry/reclaim', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({ context: f.context, history: f.history }) }));
    try {
      await entered.promise; expect(f.journal.status().active).toBe(1);
      lost.reject(Error('actual outer SQL admission connection lost'));
      expect((await pending).status).toBe(403);
      // postgres.js can reject its outer transaction before awaited native work exits.
      expect(f.journal.status().active).toBe(1); await expect(f.writers.assertAvailable()).rejects.toThrow('not released');
      valid = false; release.resolve(); await callback?.catch(() => {});
      expect(f.journal.status()).toMatchObject({ active: 0, total: 1 });
      expect(await readFile(f.path(f.layer), 'utf8')).toBe('original project layer');
    } finally { valid = false; release.resolve(); await pending; await callback?.catch(() => {}); await f.drop(); }
  });
});
