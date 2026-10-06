import { expect, test } from 'bun:test';
import { HistoricalReleaseRegisteredInventorySchema } from '../../index';

const service = { command: ['bun', 'start'], port: 3000, plan: 'small' };
const event = (manifest: unknown) => ({ projectId: 'prj_' + 'a'.repeat(32), serviceId: 'svc_' + 'b'.repeat(32), releaseId: 'rel_' + 'c'.repeat(32), tag: 'v0.1.0', commitSha: 'a'.repeat(40), occurredAt: '2026-09-10T00:00:00Z', manifest });
test('frozen release inventory validates all three complete original kinds and nested shapes without granting current execution compatibility', () => {
  const worker = { apiVersion: 'crewstation/v1', kind: 'DigitalWorker', spec: { service, development: { command: ['bun', 'dev'], port: 3001, healthPath: '/ready' }, env: [{ name: 'CONFIG', from: 'config', default: 'original' }],
    release: { migrationCommand: ['bun', 'migrate'], migration: { compatibility: 'expand-only', destructive: false, rollback: 'switch-back' } }, apis: { requested: [{ proxy: 'original', method: 'GET', path: '/read' }], exposes: { openapi: 'api.json' } },
    subscriptions: [{ eventType: 'original.event', handlerPath: '/event' }], tasks: { profile: 'standard-small', agentProfiles: [{ name: 'original', driver: 'opencode', model: 'original/model', systemPromptFile: 'prompt.md' }], outputContracts: [{ name: 'original', required: ['result.json'], schema: 'result.schema.json' }] } } };
  const proxy = { apiVersion: 'crewstation/v1', kind: 'APIProxy', spec: { service, proxy: 'original', upstream: { connection: 'original' }, apis: { exposes: { openapi: 'api.json' } } } };
  const producer = { apiVersion: 'crewstation/v1', kind: 'EventProducer', spec: { service, producer: 'original', ingress: { path: '/events', verification: 'hmac-sha256' }, produces: [{ eventType: 'original.event', schema: 'event.schema.json' }] } };
  for (const manifest of [worker, proxy, producer]) {
    expect(HistoricalReleaseRegisteredInventorySchema.safeParse(event(manifest)).success).toBe(true);
    expect(HistoricalReleaseRegisteredInventorySchema.safeParse(event({ ...manifest, spec: { ...manifest.spec, unexpected: true } })).success).toBe(false);
    expect(HistoricalReleaseRegisteredInventorySchema.safeParse(event({ ...manifest, spec: { ...manifest.spec, service: { ...service, unexpected: true } } })).success).toBe(false);
  }
  for (const spec of [{ ...worker.spec, env: [{ name: 'SECRET', from: 'secret', default: 'forbidden' }] }, { ...worker.spec, tasks: { ...worker.spec.tasks, agentProfiles: [...worker.spec.tasks.agentProfiles, ...worker.spec.tasks.agentProfiles] } },
    { ...worker.spec, tasks: { ...worker.spec.tasks, outputContracts: [...worker.spec.tasks.outputContracts, ...worker.spec.tasks.outputContracts] } }, { ...worker.spec, apis: { ...worker.spec.apis, unexpected: true } }]) expect(HistoricalReleaseRegisteredInventorySchema.safeParse(event({ ...worker, spec })).success).toBe(false);
  expect(HistoricalReleaseRegisteredInventorySchema.safeParse(event({ ...producer, spec: { ...producer.spec, produces: [{ ...producer.spec.produces[0], unexpected: true }] } })).success).toBe(false);
  expect(HistoricalReleaseRegisteredInventorySchema.safeParse(event({ ...proxy, spec: { ...proxy.spec, upstream: { connection: 'original', unexpected: true } } })).success).toBe(false);
});

test('the frozen pre-identity compute-name grammar is complete and rejects mixed versions, extra fields and incomplete profiles', () => {
  const agent = { name: 'original', compute: 'sample-stub', permission: 'read-only', systemPromptFile: 'original.md' };
  const manifest = (agentProfiles: unknown[]) => ({ apiVersion: 'crewstation/v1', kind: 'DigitalWorker', spec: { service, tasks: { profile: 'standard-small', agentProfiles } } });
  expect(HistoricalReleaseRegisteredInventorySchema.safeParse(event(manifest([agent]))).success).toBe(true);
  for (const profile of [{ ...agent, extra: true }, { ...agent, compute: '' }, { ...agent, compute: { kind: 'default' } }, { ...agent, driver: 'stub', model: 'original/model' }, { name: 'missing' }])
    expect(HistoricalReleaseRegisteredInventorySchema.safeParse(event(manifest([profile]))).success).toBe(false);
  expect(HistoricalReleaseRegisteredInventorySchema.safeParse(event(manifest([agent, { name: 'older', driver: 'stub', model: 'original/model' }]))).success).toBe(false);
  expect(HistoricalReleaseRegisteredInventorySchema.safeParse(event(manifest([agent, agent]))).success).toBe(false);
});
