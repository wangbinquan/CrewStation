import { expect, test } from 'bun:test';
import { DomainPayloadSchemas, DomainTopic } from '@crewstation/contracts';
import type { ProjectId } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { resolveInfrastructureOwnership } from './infrastructureOwnership';
import type { InfrastructureOriginSources } from '../ports/infrastructureOrigins';

const project = Bun.randomUUIDv7() as ProjectId, service = Bun.randomUUIDv7(), release = Bun.randomUUIDv7(), plan = Bun.randomUUIDv7(), profile = Bun.randomUUIDv7();
const legacy = { projectId: 'prj_' + '1'.repeat(32), serviceId: 'svc_' + '2'.repeat(32), releaseId: 'rel_' + '3'.repeat(32), tag: 'v0.1.0', commitSha: 'a'.repeat(40), occurredAt: '2026-09-10T00:00:00Z',
  manifest: { apiVersion: 'crewstation/v1', kind: 'DigitalWorker', spec: { service: { command: ['bun', 'start'], port: 3000, plan: 'small' }, tasks: { profile: 'standard-small', agentProfiles: [{ name: 'chat-v1', driver: 'stub', model: 'original/model' }] } } } };
const payload = { ...legacy, projectId: project, serviceId: service, releaseId: release, manifest: { ...legacy.manifest, apiVersion: 'crewstation/v2', spec: { ...legacy.manifest.spec, service: { command: ['bun', 'start'], port: 3000, servicePlanId: plan }, tasks: { taskProfileId: profile, agentProfiles: [{ ...legacy.manifest.spec.tasks.agentProfiles[0], id: Bun.randomUUIDv7() }] } } } };
const document = { channel: 'event' as const, name: DomainTopic.releaseRegistered, payload, legacyPayload: legacy,
  identityProvenance: { version: 'resource-identity/v1', sourceColumn: 'legacy_payload', originalHash: jsonHash(legacy), normalizedHash: jsonHash(payload) } };
const sources: InfrastructureOriginSources = { resolve: async (_document, ref) => ({ complete: true, id: ref.kind === 'project' ? project : ref.kind === 'service' ? service : release, scope: 'project', projectIds: [project], revision: jsonHash(ref.kind) }),
  historicalReleaseNormalization: async () => payload };

test('old driver/model release events can be inventoried only after complete original migration reproduction and coherent original owners', async () => {
  // Real event: identity migration changed IDs/apiVersion but deliberately preserved pre-RFC001 driver/model.
  expect(DomainPayloadSchemas[DomainTopic.releaseRegistered].strict().safeParse(payload).success).toBe(false);
  const result = await resolveInfrastructureOwnership(document, sources);
  expect(result).toMatchObject({ scope: 'project', projectIds: [project] });
  expect(result.origins.map((item) => item.id)).toEqual([project, service, release]);
  await expect(resolveInfrastructureOwnership(document, { resolve: sources.resolve })).rejects.toThrow();
  await expect(resolveInfrastructureOwnership(document, { ...sources, historicalReleaseNormalization: async () => ({ ...payload, tag: 'changed' }) })).rejects.toThrow();
  await expect(resolveInfrastructureOwnership(document, { ...sources, resolve: async () => undefined })).rejects.toThrow();
  await expect(resolveInfrastructureOwnership(document, { ...sources, resolve: async (_doc, ref, representation) => ({ complete: true, id: ref.kind === 'project' ? project : ref.kind === 'service' ? service : release, scope: 'project', projectIds: [project], revision: jsonHash([ref.kind, representation]) }) })).rejects.toThrow();
});

test('missing provenance, unknown fields, invalid old agents and current malformed events remain rejected even with a supplied normalization', async () => {
  for (const mutate of [(raw: typeof legacy) => ({ ...raw, extra: true }), (raw: typeof legacy) => ({ ...raw, manifest: { ...raw.manifest, extra: true } }),
    (raw: typeof legacy) => ({ ...raw, manifest: { ...raw.manifest, spec: { ...raw.manifest.spec, tasks: { ...raw.manifest.spec.tasks, agentProfiles: [{ name: 'chat-v1', driver: 'unknown', model: 'original/model' }] } } } }),
    (raw: typeof legacy) => ({ ...raw, manifest: { ...raw.manifest, spec: { ...raw.manifest.spec, tasks: { ...raw.manifest.spec.tasks, agentProfiles: [{ name: 'chat-v1', driver: 'stub', model: '' }] } } } })]) {
    const original = mutate(legacy);
    await expect(resolveInfrastructureOwnership({ ...document, legacyPayload: original, identityProvenance: { ...document.identityProvenance, originalHash: jsonHash(original) } }, sources)).rejects.toThrow();
  }
  for (const proof of [null, { ...document.identityProvenance, originalHash: '0'.repeat(64) }, { ...document.identityProvenance, normalizedHash: '0'.repeat(64) }, { ...document.identityProvenance, extra: true }])
    await expect(resolveInfrastructureOwnership({ ...document, identityProvenance: proof }, sources)).rejects.toThrow();
  await expect(resolveInfrastructureOwnership({ ...document, legacyPayload: null, identityProvenance: null }, sources)).rejects.toThrow();
  await expect(resolveInfrastructureOwnership({ ...document, name: 'release.unknown' }, sources)).rejects.toThrow();
});
