import { expect, test } from 'bun:test';
import type { ProjectDeletionRepairItem } from '@crewstation/contracts';
import { readEventContents } from '@crewstation/eventbus';
import { newResourceId, jsonHash } from '@crewstation/kernel';
import { readQueueContents } from '@crewstation/queue';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { operatorRetentionFixture } from './operatorRetentionFixture';
import { eventRepairRow, queueRepairRow } from '../adapters/persistence/operatorRepairCandidate';
import { retainedProvisionContent } from '../adapters/persistence/operatorRepairs';
import { infrastructureContentSource } from '../adapters/persistence/infrastructureContents';
import { infrastructureContentRemoval } from '../adapters/persistence/infrastructureRemoval';
import { inspectInfrastructureContents } from '../application/infrastructureInventory';

const available = await testDatabaseAvailable();
const request = (item: ProjectDeletionRepairItem) => ({ owner: item.owner, key: item.key, originalDigest: item.originalDigest, evidenceDigest: item.evidenceDigest, decision: 'retain' as const });

test.skipIf(!available)('17 missing tests and 12 removed-project records require individual durable retention; actual metadata cleanup preserves their complete rows and errors across EOF', async () => {
  const f = await operatorRetentionFixture();
  try {
    const filler = newResourceId(), resolve = f.origins.resolve;
    f.origins.resolve = (document, ref, representation) => ref.key === filler ? Promise.resolve({ complete: true, id: filler, scope: 'project', projectIds: [filler as typeof f.target.id], revision: jsonHash(filler) }) : resolve(document, ref, representation);
    await f.database.db.execute(sql`INSERT INTO platform_infra.jobs(kind,payload,state) SELECT 'cluster-management.refresh',jsonb_build_object('requestId',${newResourceId()}::text),'done' FROM generate_series(1,601)`);
    await f.database.db.execute(sql`INSERT INTO platform_infra.domain_events(topic,payload,occurred_at) SELECT 'project.archived',jsonb_build_object('projectId',${filler}::text,'occurredAt','2026-10-06T00:00:00Z'),'2026-10-06'::timestamptz FROM generate_series(1,601)`);
    for (let i = 0; i < 17; i++) await f.queue('agent-runtime.profile-test', { testId: newResourceId() });
    await f.queue('project.provision', { projectId: f.foreign });
    for (let i = 0; i < 4; i++) await f.queue('release.pipeline', { releaseId: newResourceId() });
    const originalEvent = await f.event('project.created', f.payloads.created); await f.event('project.archived', f.payloads.archived); await f.event('release.registered', f.payloads.registered);
    for (let i = 0; i < 4; i++) await f.event('release.status-changed', f.payloads.status);
    const ownQueue = await f.queue('project.provision', { projectId: f.target.id }), ownEvent = await f.event('project.archived', { ...f.payloads.archived, projectId: f.target.id });
    await f.database.db.execute(sql`INSERT INTO platform_infra.event_dead_letters(consumer,event_id,error) VALUES('one',${originalEvent}::bigint,'original private event error'),('two',${originalEvent}::bigint,'another original error')`);
    const before = await f.snapshot(), items = await f.owner().inspect(f.target); expect(items).toHaveLength(29);
    expect(items.every(item => item.allowedDecisions.join() === 'retain' && item.confirmed === null)).toBe(true);
    const inspect = () => inspectInfrastructureContents(f.target.id, infrastructureContentSource(f.database.db), f.origins, undefined, row => retainedProvisionContent(f.database.db, f.origins, f.target, row));
    expect((await inspect()).inventory.complete).toBe(false);
    for (const item of items) await f.owner().confirm(f.target, f.actor, request(item));
    expect((await f.owner().inspect(f.target)).every(item => item.confirmed?.actorId === f.actor.userId)).toBe(true);
    const inventory = await inspect(); expect(inventory.inventory.complete).toBe(true);
    expect(inventory.traversal).toMatchObject({ queue: true, event: true, orphanErrors: true, scanned: { queue: 624, event: 609, orphanErrors: 0 } });
    expect(inventory.contents.map(row => row.channel + ':' + row.id).sort()).toEqual(['queue:' + ownQueue, 'event:' + ownEvent].sort());
    expect(await infrastructureContentRemoval(f.database.db).remove(inventory.contents)).toBe(true);
    const after = await f.snapshot(); expect(after.event).toEqual(before.event.filter(row => row.id !== ownEvent)); expect(after.errors).toEqual(before.errors);
    expect(after.queue).toEqual(before.queue.filter(row => row.id !== ownQueue));
    const retainedQueues = await f.database.db.execute(sql`SELECT to_jsonb(j) AS body FROM platform_infra.jobs j WHERE kind <> 'cluster-management.refresh' ORDER BY id`);
    expect(retainedQueues).toHaveLength(22); expect((await inspect()).inventory.complete).toBe(true);
    expect((await f.owner().inspect(f.target)).every(item => item.confirmed !== null)).toBe(true);
  } finally { await f.database.drop(); }
}, 30_000);

test.skipIf(!available)('fresh whole-row, birth, source, current resources and authorization checks invalidate retention without rewriting original records', async () => {
  const f = await operatorRetentionFixture();
  try {
    const id = await f.queue('agent-runtime.profile-test', { testId: newResourceId() }), [row] = await readQueueContents(f.database.db), original = queueRepairRow(row!);
    const [item] = await f.owner().inspect(f.target), input = request(item!);
    await expect(f.owner().confirm(f.target, { ...f.actor, isAdmin: false }, input)).rejects.toThrow();
    await expect(f.owner().confirm({ ...f.target, id: newResourceId() as typeof f.target.id }, f.actor, input)).rejects.toThrow();
    await f.owner().confirm(f.target, f.actor, input);
    expect(await retainedProvisionContent(f.database.db, f.origins, f.target, original)).toMatch(/^[a-f0-9]{64}$/);
    expect(await retainedProvisionContent(f.database.db, f.origins, { ...f.target, state: 'deleting', revision: '2' }, original)).toBe(await retainedProvisionContent(f.database.db, f.origins, f.target, original));
    for (const flag of ['active', 'shared', 'profileActive'] as const) {
      f.state[flag] = true; expect((await f.owner().inspect(f.target))[0]!.allowedDecisions).toEqual([]);
      await expect(f.owner().confirm(f.target, f.actor, input)).rejects.toThrow(); f.state[flag] = false;
    }
    for (const flag of ['complete', 'profileComplete'] as const) {
      f.state[flag] = false; await expect(f.owner().inspect(f.target)).rejects.toThrow(); f.state[flag] = true;
    }
    f.state.failure = true; await expect(f.owner().confirm(f.target, f.actor, input)).rejects.toThrow(); f.state.failure = false;
    f.state.known = true; expect(await f.owner().inspect(f.target)).toEqual([]); expect(await retainedProvisionContent(f.database.db, f.origins, f.target, original)).toBeUndefined(); f.state.known = false;
    f.state.revision++; expect((await f.owner().inspect(f.target))[0]!.confirmed).toBeNull(); f.state.revision--;
    await f.database.db.execute(sql`UPDATE platform_infra.jobs SET last_error=${'hidden target ' + f.target.id} WHERE id=${id}::bigint`);
    expect((await f.owner().inspect(f.target))[0]!.allowedDecisions).toEqual([]); expect(await retainedProvisionContent(f.database.db, f.origins, f.target, original)).toBeUndefined();
    await f.database.db.execute(sql`UPDATE platform_infra.jobs SET last_error='original private error',created_at=created_at+interval '1 second' WHERE id=${id}::bigint`);
    expect((await f.owner().inspect(f.target))[0]!.confirmed).toBeNull(); await expect(f.owner().confirm(f.target, f.actor, input)).rejects.toThrow();
    expect(await f.origins.resolve(original.document, { kind: 'profile-test', key: (row!.payload as { testId: string }).testId }, 'current')).toBeUndefined();
  } finally { await f.database.drop(); }
});

test.skipIf(!available)('terminal-only guards and whole original event errors/manifest references block retention; legacy references are reread and malformed or unknown content stays blocked', async () => {
  const f = await operatorRetentionFixture();
  try {
    const queueId = await f.queue('project.provision', { projectId: f.foreign }, 'running');
    expect((await f.owner().inspect(f.target))[0]!.allowedDecisions).toEqual([]);
    await f.database.db.execute(sql`UPDATE platform_infra.jobs SET state='dead' WHERE id=${queueId}::bigint`);
    const id = await f.event('release.registered', { ...f.payloads.registered, openapiDocument: { nested: [{ link: 'https://' + f.target.prodHost }] } });
    expect((await f.owner().inspect(f.target)).find(item => item.key === 'event:' + id)!.allowedDecisions).toEqual([]);
    await f.database.db.execute(sql`UPDATE platform_infra.domain_events SET payload=${JSON.stringify(f.payloads.registered)}::jsonb WHERE id=${id}::bigint`);
    const item = (await f.owner().inspect(f.target)).find(item => item.key === 'event:' + id)!; await f.owner().confirm(f.target, f.actor, request(item));
    const [row] = await readEventContents(f.database.db); await f.database.db.execute(sql`INSERT INTO platform_infra.event_dead_letters(consumer,event_id,error) VALUES('original',${id}::bigint,'whole original error')`);
    expect(await retainedProvisionContent(f.database.db, f.origins, f.target, eventRepairRow(row!))).toBeUndefined();
    const changed = (await f.owner().inspect(f.target)).find(item => item.key === 'event:' + id)!; expect(changed.confirmed).toBeNull(); await f.owner().confirm(f.target, f.actor, request(changed));
    await f.database.db.execute(sql`UPDATE platform_infra.event_dead_letters SET error=${'nested context ' + f.target.serviceId} WHERE event_id=${id}::bigint`);
    expect((await f.owner().inspect(f.target)).find(item => item.key === 'event:' + id)!.allowedDecisions).toEqual([]);
    const payload = { projectId: f.foreign }, legacy = { projectId: f.foreign }, proof = { version: 'resource-identity/v1', sourceColumn: 'legacy_payload', originalHash: jsonHash(legacy), normalizedHash: jsonHash(payload) };
    await f.database.db.execute(sql`UPDATE platform_infra.jobs SET legacy_payload=${JSON.stringify(legacy)}::jsonb,identity_provenance=${JSON.stringify(proof)}::jsonb WHERE id=${queueId}::bigint`);
    expect((await f.owner().inspect(f.target))[0]!.allowedDecisions).toEqual(['retain']); expect(f.calls).toContain('legacy:project:' + f.foreign);
    await f.database.db.execute(sql`UPDATE platform_infra.jobs SET identity_provenance=jsonb_set(identity_provenance,'{originalHash}','"bad"'::jsonb) WHERE id=${queueId}::bigint`);
    await expect(f.owner().inspect(f.target)).rejects.toThrow();
    await f.database.db.execute(sql`UPDATE platform_infra.jobs SET legacy_payload=NULL,identity_provenance=NULL,payload=${JSON.stringify({ ...payload, unexpected: true })}::jsonb WHERE id=${queueId}::bigint`);
    await expect(f.owner().inspect(f.target)).rejects.toThrow();
    await f.database.db.execute(sql`UPDATE platform_infra.jobs SET kind='unknown',payload='{}'::jsonb WHERE id=${queueId}::bigint`);
    expect((await f.owner().inspect(f.target)).some(item => item.key === 'queue:' + queueId)).toBe(false);
    await f.database.db.execute(sql`UPDATE platform_infra.domain_events SET payload=${JSON.stringify({ ...f.payloads.registered, unexpected: true })}::jsonb WHERE id=${id}::bigint`);
    await expect(f.owner().inspect(f.target)).rejects.toThrow();
    await f.database.db.execute(sql`UPDATE platform_infra.domain_events SET topic='unknown',payload='{}'::jsonb WHERE id=${id}::bigint`);
    expect(await f.owner().inspect(f.target)).toEqual([]);
    expect((await inspectInfrastructureContents(f.target.id, infrastructureContentSource(f.database.db), f.origins)).inventory.complete).toBe(false);
  } finally { await f.database.drop(); }
});

test.skipIf(!available)('a source change during save rolls back the immutable decision; retired aliases are verified independently of missing ownership', async () => {
  const f = await operatorRetentionFixture();
  try {
    const id = await f.queue('agent-runtime.profile-test', { testId: newResourceId() }), [row] = await readQueueContents(f.database.db);
    const legacy = { testId: 'old-test-key' }, proof = { version: 'resource-identity/v1', sourceColumn: 'legacy_payload', originalHash: jsonHash(legacy), normalizedHash: jsonHash(row!.payload) };
    f.state.retired = true; f.state.aliases = ['old-test-key'];
    await f.database.db.execute(sql`UPDATE platform_infra.jobs SET legacy_payload=${JSON.stringify(legacy)}::jsonb,identity_provenance=${JSON.stringify(proof)}::jsonb WHERE id=${id}::bigint`);
    const [item] = await f.owner().inspect(f.target), inspect = f.origins.currentAssets!.inspect; let reads = 0;
    f.origins.currentAssets!.inspect = (target, selectors) => { if (++reads === 2) f.state.revision++; return inspect(target, selectors); };
    await expect(f.owner().confirm(f.target, f.actor, request(item!))).rejects.toThrow('保存期间变化');
    expect((await f.database.db.execute<{ count: number }>(sql`SELECT count(*)::integer AS count FROM provisioning.operator_confirmations`))[0]!.count).toBe(0);
    f.origins.currentAssets!.inspect = inspect;
    const [fresh] = await f.owner().inspect(f.target); await f.owner().confirm(f.target, f.actor, request(fresh!));
    expect(f.calls).toContain('legacy:profile-test:old-test-key');
    f.state.aliases = []; expect((await f.owner().inspect(f.target))[0]!.allowedDecisions).toEqual([]);
    f.state.retired = false; f.state.aliases = ['old-test-key']; expect((await f.owner().inspect(f.target))[0]!.allowedDecisions).toEqual([]);
  } finally { await f.database.drop(); }
});
