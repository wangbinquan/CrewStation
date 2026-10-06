import { expect, test } from 'bun:test';
import { DomainPayloadSchemas, DomainTopic, HistoricalReleaseRegisteredInventorySchema } from '@crewstation/contracts';
import { reproduceHistoricalRelease } from './historicalRelease';

const original = () => ({ projectId: 'prj_' + '1'.repeat(32), serviceId: 'svc_' + '2'.repeat(32), releaseId: 'rel_' + '3'.repeat(32), occurredAt: '2026-09-10T00:00:00Z', tag: 'v0.1', commitSha: 'original',
  manifest: { apiVersion: 'crewstation/v1', kind: 'DigitalWorker', spec: { service: { command: ['run'], port: 3000, plan: 'small' }, tasks: { profile: 'standard-small', agentProfiles: [{ name: 'chat-v1', driver: 'stub', model: 'original/model' }], outputContracts: [{ name: 'chat-result', required: ['result.json'] }] }, env: [{ name: 'SITE_NAME', from: 'config' }], apis: { requested: [{ proxy: 'internal-api', method: 'GET', path: '/ping' }] }, subscriptions: [{ eventType: 'gitlab.pipeline.finished', handlerPath: '/event' }] } } });

test('the locked original event migration re-derives every ID from existing scoped aliases and retains old driver/model without producing a current executable event', async () => {
  const raw = original(), calls: string[][] = [], identities = new Map<string, string>();
  const resolve = async (kind: string, keys: readonly string[]) => { calls.push([kind, ...keys]); const key = JSON.stringify([kind, keys]); let id = identities.get(key); if (!id) { id = Bun.randomUUIDv7(); identities.set(key, id); } return id; };
  const result = await reproduceHistoricalRelease(raw, { resolve });
  expect(calls).toHaveLength(10);
  expect(calls).toContainEqual(['configDefinition', raw.projectId, 'SITE_NAME']);
  expect(calls).toContainEqual(['agent-profile', raw.serviceId, 'chat-v1']);
  expect(calls).toContainEqual(['output-contract', raw.serviceId, 'chat-result']);
  expect(result).toMatchObject({ manifest: { apiVersion: 'crewstation/v2', spec: { tasks: { agentProfiles: [{ name: 'chat-v1', driver: 'stub', model: 'original/model' }] } } } });
  expect(DomainPayloadSchemas[DomainTopic.releaseRegistered].strict().safeParse(result).success).toBe(false);
  expect(raw).toEqual(original());
  await expect(reproduceHistoricalRelease(raw, { resolve: async () => undefined })).rejects.toThrow('unavailable');
});

test('the complete frozen grammar supports all original kinds and rejects extra keys, malformed nested fields and incomplete agent profiles', () => {
  const raw = original(); expect(HistoricalReleaseRegisteredInventorySchema.safeParse(raw).success).toBe(true);
  const base = { service: { command: ['run'], port: 80, plan: 'small' }, development: { command: ['dev'], port: 8080, healthPath: '/ready' }, env: [], release: { migrationCommand: ['migrate'], migration: { compatibility: 'expand-only', destructive: false, rollback: 'switch-back' } } };
  const proxy = { ...raw, manifest: { apiVersion: 'crewstation/v1', kind: 'APIProxy', spec: { ...base, proxy: 'internal-api', upstream: { connection: 'upstream-main' }, apis: { exposes: { openapi: 'openapi.json' } } } } };
  const producer = { ...raw, manifest: { apiVersion: 'crewstation/v1', kind: 'EventProducer', spec: { ...base, producer: 'gitlab-producer', ingress: { path: '/events', verification: 'gitlab-token' }, produces: [{ eventType: 'gitlab.pipeline.finished', schema: 'event.json' }] } } };
  for (const input of [raw, proxy, producer]) {
    expect(HistoricalReleaseRegisteredInventorySchema.safeParse(input).success).toBe(true);
    expect(HistoricalReleaseRegisteredInventorySchema.safeParse({ ...input, extra: true }).success).toBe(false);
    expect(HistoricalReleaseRegisteredInventorySchema.safeParse({ ...input, manifest: { ...input.manifest, spec: { ...input.manifest.spec, extra: true } } }).success).toBe(false);
    expect(HistoricalReleaseRegisteredInventorySchema.safeParse({ ...input, manifest: { ...input.manifest, spec: { ...input.manifest.spec, service: { ...input.manifest.spec.service, extra: true } } } }).success).toBe(false);
  }
  for (const agent of [{ name: 'chat-v1', driver: 'unknown', model: 'x' }, { name: 'chat-v1', driver: 'stub', model: '' }, { name: 'chat-v1', driver: 'stub', model: 'x', compute: 'default' }, { name: 'chat-v1', driver: 'stub', model: 'x', extra: true }])
    expect(HistoricalReleaseRegisteredInventorySchema.safeParse({ ...raw, manifest: { ...raw.manifest, spec: { ...raw.manifest.spec, tasks: { ...raw.manifest.spec.tasks, agentProfiles: [agent] } } } }).success).toBe(false);
  expect(HistoricalReleaseRegisteredInventorySchema.safeParse({ ...raw, manifest: { ...raw.manifest, spec: { ...raw.manifest.spec, env: [{ name: 'SECRET', from: 'secret', default: 'bad' }] } } }).success).toBe(false);
  const duplicate = [raw.manifest.spec.tasks.agentProfiles[0], raw.manifest.spec.tasks.agentProfiles[0]];
  expect(HistoricalReleaseRegisteredInventorySchema.safeParse({ ...raw, manifest: { ...raw.manifest, spec: { ...raw.manifest.spec, tasks: { ...raw.manifest.spec.tasks, agentProfiles: duplicate } } } }).success).toBe(false);
});

test('the immutable event migration reproduces the frozen compute-name grammar with scoped original profile aliases', async () => {
  const raw = original(), before = structuredClone(raw), calls: string[][] = [];
  const input = { ...raw, manifest: { ...raw.manifest, spec: { ...raw.manifest.spec, tasks: { ...raw.manifest.spec.tasks, agentProfiles: [{ name: 'chat-v1', compute: 'sample-stub', permission: 'read-only' }, { name: 'default-agent', compute: 'default' }] } } } };
  const result = await reproduceHistoricalRelease(input, { resolve: async (kind, keys) => { calls.push([kind, ...keys]); return Bun.randomUUIDv7(); } });
  expect(calls).toContainEqual(['compute-profile', 'sample-stub']);
  expect(calls).toContainEqual(['agent-profile', raw.serviceId, 'chat-v1']);
  expect(result).toMatchObject({ manifest: { apiVersion: 'crewstation/v2', spec: { tasks: { agentProfiles: [{ name: 'chat-v1', compute: { kind: 'profile' }, permission: 'read-only' }, { name: 'default-agent', compute: { kind: 'default' } }] } } } });
  expect(DomainPayloadSchemas[DomainTopic.releaseRegistered].strict().safeParse(result).success).toBe(true);
  expect(DomainPayloadSchemas[DomainTopic.releaseRegistered].strict().safeParse(input).success).toBe(false);
  expect(raw).toEqual(before);
});
