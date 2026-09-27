import { expect, test } from 'bun:test';
import { ManifestSchema } from './manifest';

const id = '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10';
const other = '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d11';
const service = { command: ['app'], port: 3000, servicePlanId: id };
const tasks = { taskProfileId: id, agentProfiles: [{ id, name: 'agent', compute: { kind: 'default' } }] };
const manifest = { apiVersion: 'crewstation/v3', kind: 'DigitalWorker', spec: { service, tasks } };

test('Manifest v3 independently selects service, parent task and each Agent image; absent fields stay absent', () => {
  const parsed = ManifestSchema.parse({ ...manifest, spec: {
    service: { ...service, runtimeImageVersionId: id },
    tasks: { ...tasks, runtimeImageVersionId: other, allowedRuntimeImageVersionIds: [id], agentProfiles: [{ ...tasks.agentProfiles[0], runtimeImageVersionId: id, allowedRuntimeImageVersionIds: [other] }] },
  } });
  expect(parsed.spec.service.runtimeImageVersionId).toBe(id);
  if (parsed.kind !== 'DigitalWorker') throw new Error('wrong kind');
  expect(parsed.spec.tasks).toMatchObject({ runtimeImageVersionId: other, allowedRuntimeImageVersionIds: [id], agentProfiles: [{ runtimeImageVersionId: id, allowedRuntimeImageVersionIds: [other] }] });
  expect(ManifestSchema.parse(manifest).spec.service).not.toHaveProperty('runtimeImageVersionId');
});

test('v2 explicitly rejects every image field, including an empty allowlist, with an upgrade message', () => {
  for (const field of ['runtimeImageVersionId', 'allowedRuntimeImageVersionIds']) {
    const value = field === 'runtimeImageVersionId' ? id : [];
    for (const spec of [
      { service, tasks: { ...tasks, [field]: value } },
      { service, tasks: { ...tasks, agentProfiles: [{ ...tasks.agentProfiles[0], [field]: value }] } },
      ...(field === 'runtimeImageVersionId' ? [{ service: { ...service, [field]: value }, tasks }] : []),
    ]) {
      const result = ManifestSchema.safeParse({ ...manifest, apiVersion: 'crewstation/v2', spec });
      expect(result.success).toBe(false);
      expect(result.error?.issues.some((issue) => issue.message.includes('crewstation/v3'))).toBe(true);
    }
  }
});

test('service image selection works for all service kinds; bad UUID and duplicate allowlists fail', () => {
  for (const variant of [
    { kind: 'APIProxy', spec: { proxy: 'test', upstream: { connection: 'upstream' }, apis: { exposes: { openapi: 'openapi.yaml' } } } },
    { kind: 'EventProducer', spec: { producer: 'test', ingress: { path: '/events' }, produces: [{ eventType: 'example.event' }] } },
  ]) {
    const input = { apiVersion: 'crewstation/v3', kind: variant.kind, spec: { ...variant.spec, service: { ...service, runtimeImageVersionId: id } } };
    expect(ManifestSchema.safeParse(input).success).toBe(true);
    expect(ManifestSchema.safeParse({ ...input, apiVersion: 'crewstation/v2' }).success).toBe(false);
  }
  expect(ManifestSchema.safeParse({ ...manifest, spec: { service: { ...service, runtimeImageVersionId: 'latest' } } }).success).toBe(false);
  expect(ManifestSchema.safeParse({ ...manifest, spec: { service, tasks: { ...tasks, allowedRuntimeImageVersionIds: [id, id] } } }).success).toBe(false);
});
