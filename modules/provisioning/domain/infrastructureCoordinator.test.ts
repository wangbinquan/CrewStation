import { describe, expect, test } from 'bun:test';
import { DomainTopic } from '@crewstation/contracts';
import type { ProjectId } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import type { InfrastructureOriginDocument } from './infrastructureOrigins';
import { isInfrastructureCoordinator } from './infrastructureCoordinator';

const projectId = Bun.randomUUIDv7() as ProjectId, operationId = Bun.randomUUIDv7(), coordinator = { projectId, operationId };
const queue: InfrastructureOriginDocument = { channel: 'queue', name: 'provisioning.project-deletion', payload: { operationId }, legacyPayload: null, identityProvenance: null };
const event: InfrastructureOriginDocument = { ...queue, channel: 'event', name: DomainTopic.projectDeletionRequested,
  payload: { projectId, operationId, occurredAt: '2026-10-03T00:00:00Z' } };
describe('original deletion coordinator retention', () => {
  test('retains only the current operation and its original project, with exact closed payloads', () => {
    expect(isInfrastructureCoordinator(queue, coordinator)).toBe(true);
    expect(isInfrastructureCoordinator(event, coordinator)).toBe(true);
    for (const document of [{ ...queue, name: 'project.provision' }, { ...event, name: DomainTopic.configChanged },
      { ...queue, payload: { operationId: Bun.randomUUIDv7() } }, { ...event, payload: { projectId, operationId: Bun.randomUUIDv7(), occurredAt: '2026-10-03T00:00:00Z' } }])
      expect(isInfrastructureCoordinator(document, coordinator)).toBe(false);
    expect(() => isInfrastructureCoordinator({ ...event, payload: { ...(event.payload as object), projectId: Bun.randomUUIDv7() } }, coordinator)).toThrow();
    expect(() => isInfrastructureCoordinator({ ...queue, payload: { operationId, extra: 'private' } }, coordinator)).toThrow();
  });
  test('historical content must represent this same operation, with original and normalized hashes intact', () => {
    const legacyPayload = { operationId }, identityProvenance = { version: 'resource-identity/v1', sourceColumn: 'legacy_payload',
      originalHash: jsonHash(legacyPayload), normalizedHash: jsonHash(queue.payload) };
    expect(isInfrastructureCoordinator({ ...queue, legacyPayload, identityProvenance }, coordinator)).toBe(true);
    const different = { operationId: Bun.randomUUIDv7() };
    expect(() => isInfrastructureCoordinator({ ...queue, legacyPayload: different, identityProvenance: { ...identityProvenance, originalHash: jsonHash(different) } }, coordinator)).toThrow();
    expect(() => isInfrastructureCoordinator({ ...queue, legacyPayload, identityProvenance: { ...identityProvenance, normalizedHash: jsonHash('changed') } }, coordinator)).toThrow();
  });
});
