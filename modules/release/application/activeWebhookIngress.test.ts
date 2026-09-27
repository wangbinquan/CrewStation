import { expect, test } from 'bun:test';
import { ManifestSchema } from '@crewstation/contracts';
import type { ServiceId } from '@crewstation/contracts';
import { activeWebhookIngress } from './activeWebhookIngress';
import type { RepositoryScope } from '../ports/unitOfWork';

const manifest = ManifestSchema.parse({ apiVersion: 'crewstation/v2', kind: 'EventProducer', spec: {
  service: { command: ['bun', 'run', 'src/main.ts'], port: 3000, servicePlanId: Bun.randomUUIDv7() }, producer: 'github',
  ingress: { path: '/hooks/github', verification: 'hmac-sha256' }, produces: [{ eventType: 'github.push' }],
} });

test('external ingress follows ready active release, revokes on offline and excludes unsigned manifests', async () => {
  let slots: Record<string, unknown> | undefined = undefined;
  let release: Record<string, unknown> | undefined;
  const requested: string[] = [];
  const read = { slots: { get: async () => slots }, releases: { getById: async (id: string) => { requested.push(id); return release; } } } as unknown as Pick<RepositoryScope, 'slots' | 'releases'>;
  const lookup = activeWebhookIngress(read), id = Bun.randomUUIDv7() as ServiceId;
  expect(await lookup(id)).toBeUndefined();
  slots = { active: 'blue', blue: { state: 'ready', replicas: 1, releaseId: 'production' }, green: { state: 'ready', replicas: 1, releaseId: 'standby' } };
  release = { status: 'ready', manifest };
  expect(await lookup(id)).toBe('/hooks/github'); expect(requested.at(-1)).toBe('production');
  slots.active = 'green'; expect(await lookup(id)).toBe('/hooks/github'); expect(requested.at(-1)).toBe('standby');
  for (const slot of [{ state: 'empty', replicas: 0 }, { state: 'deploying', replicas: 1, releaseId: 'x' }, { state: 'ready', replicas: 0, releaseId: 'x' }]) {
    slots.green = slot; expect(await lookup(id)).toBeUndefined();
  }
  slots.green = { state: 'ready', replicas: 1, releaseId: 'x' };
  for (const value of [undefined, { status: 'failed', manifest }, { status: 'ready', manifest: { kind: 'DigitalWorker' } }, { status: 'ready', manifest: { ...manifest, spec: { ...manifest.spec, ingress: { path: '/hook', verification: 'none' } } } }]) {
    release = value; expect(await lookup(id)).toBeUndefined();
  }
});
