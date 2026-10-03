import { describe, expect, test } from 'bun:test';
import { DomainTopic } from '@crewstation/contracts';
import type { ProjectId } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import type { InfrastructureContentRow, InfrastructureOrphanError } from '../domain/infrastructureContents';
import type { InfrastructureContentReader, InfrastructureContentSource } from '../ports/infrastructureContents';
import type { InfrastructureOriginSources } from '../ports/infrastructureOrigins';
import { inspectInfrastructureContents } from './infrastructureInventory';

const project = Bun.randomUUIDv7() as ProjectId, other = Bun.randomUUIDv7() as ProjectId;
const row = (id: string, projectId = project): InfrastructureContentRow => ({ id, birthDigest: jsonHash('birth:' + id), contentDigest: jsonHash('content:' + id), deadLetters: 0,
  document: { channel: 'queue', name: 'project.provision', payload: { projectId }, legacyPayload: null, identityProvenance: null } });
const origins: InfrastructureOriginSources = { resolve: async (_document, reference) => ({ complete: true, id: reference.key, scope: 'project', projectIds: [reference.key as ProjectId], revision: jsonHash(reference) }) };
const source = (queue: InfrastructureContentReader['queue'], overrides: Partial<InfrastructureContentReader> = {}): InfrastructureContentSource => ({
  withSnapshot: (read) => read({ queue, event: async () => [], orphanErrors: async () => [], ...overrides }),
});
describe('infrastructure EOF inventory (controlled content and original sources; no physical proof)', () => {
  test('the active coordinator stays outside confirmed content until atomic completion; other operations still require original ownership', async () => {
    const operationId = Bun.randomUUIDv7(), different = Bun.randomUUIDv7();
    const queue = { ...row('1'), document: { ...row('1').document, name: 'provisioning.project-deletion', payload: { operationId } } };
    const event: InfrastructureContentRow = { ...row('2'), deadLetters: 1, document: { ...row('2').document, channel: 'event', name: DomainTopic.projectDeletionRequested,
      payload: { projectId: project, operationId, occurredAt: '2026-10-03T00:00:00Z' } } };
    const input = source(async (after) => after === null ? [queue] : [], { event: async (after) => after === null ? [event] : [] });
    const result = await inspectInfrastructureContents(project, input, { resolve: async () => { throw new Error('must not resolve current coordinator'); } }, { projectId: project, operationId });
    expect(result.inventory).toMatchObject({ complete: true, resources: [] }); expect(result.contents).toEqual([]);
    expect(result.traversal.scanned).toEqual({ queue: 1, event: 1, orphanErrors: 0 });
    const ordinary = await inspectInfrastructureContents(project, input, { resolve: async () => undefined }, { projectId: project, operationId: different });
    expect(ordinary.inventory.complete).toBe(false); expect(ordinary.inventory.blockers).toHaveLength(2);
    await expect(inspectInfrastructureContents(project, input, origins, { projectId: other, operationId })).rejects.toThrow();
  });
  test('short pages continue to empty EOF, preserving exact bigint IDs and only the selected original project', async () => {
    const pages = [[row('1', other)], [row('9007199254740993')], [row('9007199254740994', other)], []], calls: (string | null)[] = [];
    const result = await inspectInfrastructureContents(project, source(async (after) => { calls.push(after); return pages.shift()!; }), origins);
    expect(calls).toEqual([null, '1', '9007199254740993', '9007199254740994']);
    expect(result.traversal).toMatchObject({ queue: true, event: true, orphanErrors: true, scanned: { queue: 3, event: 0, orphanErrors: 0 } });
    expect(result.inventory.complete).toBe(true); expect(result.contents.map((value) => value.id)).toEqual(['9007199254740993']);
    expect(result.inventory.resources[0]).toMatchObject({ id: 'queue:9007199254740993', scope: 'metadata', count: 1 });
    expect(JSON.stringify(result)).not.toContain('project.provision'); expect(JSON.stringify(result)).not.toContain('payload');
  });
  test('unknown content and unreadable originals block even if all traversals reach EOF; private source errors stay private', async () => {
    const rows = [row('1'), { ...row('2'), document: { ...row('2').document, name: 'future-job' } }];
    const result = await inspectInfrastructureContents(project, source(async (after) => after === null ? rows : []), {
      resolve: async () => { throw new Error('private credential and source body'); },
    });
    expect(result.inventory.complete).toBe(false); expect(result.inventory.blockers).toHaveLength(2);
    expect(result.traversal.queue).toBe(true); expect(JSON.stringify(result)).not.toContain('credential');
    const missing = await inspectInfrastructureContents(project, source(async (after) => after === null ? [row('1')] : []), { resolve: async () => undefined });
    expect(missing.inventory.blockers[0]?.code).toBe('infrastructure-origin-unavailable');
  });
  test('duplicate/backward/malformed/oversized pages and interrupted snapshots never produce a complete inventory', async () => {
    for (const rows of [[row('2'), row('1')], [row('1'), row('1')], [row('0')], [{ ...row('1'), deadLetters: 1 }],
      [{ ...row('1'), document: { ...row('1').document, channel: 'event' } }], Array.from({ length: 201 }, (_value, i) => row(String(i + 1)))]) {
      const result = await inspectInfrastructureContents(project, source(async () => rows as readonly InfrastructureContentRow[]), origins);
      expect(result.inventory.complete).toBe(false); expect(result.traversal.queue).toBe(false);
      expect(result.inventory.blockers.some((value) => value.code === 'infrastructure-traversal-incomplete')).toBe(true);
    }
    const result = await inspectInfrastructureContents(project, { withSnapshot: async () => { throw new Error('private database URI'); } }, origins);
    expect(result.inventory.complete).toBe(false); expect(result.inventory.blockers[0]?.code).toBe('infrastructure-snapshot-unavailable');
    expect(JSON.stringify(result)).not.toContain('database URI');
    const interrupted = await inspectInfrastructureContents(project, source(async (after) => { if (after) throw new Error('late failure'); return [row('1')]; }), origins);
    expect(interrupted.contents).toHaveLength(1); expect(interrupted.traversal.queue).toBe(false); expect(interrupted.inventory.complete).toBe(false);
  });
  test('orphan errors are paged using UTF-8 C order and never silently become platform-owned or leak consumer names', async () => {
    const error = (consumer: string): InfrastructureOrphanError => ({ eventId: '9007199254740993', consumer, digest: jsonHash(consumer) });
    const pages = [[error('\uE000')], [error('\u{10000}')], []], cursors: unknown[] = [];
    const result = await inspectInfrastructureContents(project, source(async () => [], { orphanErrors: async (after) => { cursors.push(after); return pages.shift()!; } }), origins);
    expect(result.traversal.orphanErrors).toBe(true); expect(result.traversal.scanned.orphanErrors).toBe(2);
    expect(cursors).toEqual([null, { eventId: '9007199254740993', consumer: '\uE000' }, { eventId: '9007199254740993', consumer: '\u{10000}' }]);
    expect(result.inventory.complete).toBe(false); expect(result.inventory.blockers.map((value) => value.code)).toEqual(['infrastructure-orphan-error', 'infrastructure-orphan-error']);
    expect(JSON.stringify(result)).not.toContain('\uE000'); expect(JSON.stringify(result)).not.toContain('\u{10000}');
    for (const rows of [[error('b'), error('a')], [error('a'), error('a')], [{ ...error('a'), eventId: '0' }],
      Array.from({ length: 201 }, () => error('a'))]) {
      const bad = await inspectInfrastructureContents(project, source(async () => [], { orphanErrors: async () => rows }), origins);
      expect(bad.traversal.orphanErrors).toBe(false); expect(bad.inventory.complete).toBe(false);
    }
  });
});
