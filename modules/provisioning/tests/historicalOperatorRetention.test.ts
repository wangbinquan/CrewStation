import { expect, test } from 'bun:test';
import { DomainPayloadSchemas, DomainTopic } from '@crewstation/contracts';
import type { ProjectDeletionRepairItem } from '@crewstation/contracts';
import { reproduceHistoricalRelease } from '@crewstation/eventbus';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { operatorRetentionFixture } from './operatorRetentionFixture';

const available = await testDatabaseAvailable();
const request = (item: ProjectDeletionRepairItem) => ({ owner: item.owner, key: item.key, originalDigest: item.originalDigest, evidenceDigest: item.evidenceDigest, decision: 'retain' as const });
async function historicalEvent(f: Awaited<ReturnType<typeof operatorRetentionFixture>>) {
  const original = { projectId: 'prj_' + '1'.repeat(32), serviceId: 'svc_' + '2'.repeat(32), releaseId: 'rel_' + '3'.repeat(32), tag: 'v0.1', commitSha: 'original', occurredAt: '2026-09-10T00:00:00Z',
    manifest: { apiVersion: 'crewstation/v1', kind: 'DigitalWorker', spec: { service: { command: ['run'], port: 3000, plan: 'small' }, tasks: { profile: 'standard-small', agentProfiles: [{ name: 'chat-v1', driver: 'stub', model: 'original/model' }] } } } };
  const identities = new Map<string, string>(), resolve = async (kind: string, keys: readonly string[]) => {
    const key = jsonHash([kind, keys]); let value = identities.get(key); if (!value) { value = newResourceId(); identities.set(key, value); } return value;
  };
  const payload = await reproduceHistoricalRelease(original, { resolve }), proof = { version: 'resource-identity/v1', sourceColumn: 'legacy_payload', originalHash: jsonHash(original), normalizedHash: jsonHash(payload) };
  f.origins.historicalReleaseNormalization = (document) => reproduceHistoricalRelease(document.legacyPayload, { resolve });
  const id = await f.event(DomainTopic.releaseRegistered, payload);
  await f.database.db.execute(sql`UPDATE platform_infra.domain_events SET legacy_payload=${JSON.stringify(original)}::jsonb,identity_provenance=${JSON.stringify(proof)}::jsonb WHERE id=${id}::bigint`);
  return { id, payload, original, proof };
}

test.skipIf(!available)('a complete known historical driver/model event no longer aborts the entire repair candidate EOF; current execution still rejects it', async () => {
  const f = await operatorRetentionFixture();
  try {
    const history = await historicalEvent(f), missing = await f.queue('agent-runtime.profile-test', { testId: newResourceId() }), missingResolve = f.origins.resolve;
    // The defect happened before owner filtering: one valid old foreign release hid every following candidate.
    f.origins.resolve = (document, ref, representation) => document.channel === 'event' ? Promise.resolve({ complete: true, id: ref.key, scope: 'project', projectIds: [f.foreign], revision: jsonHash(ref.kind) }) : missingResolve(document, ref, representation);
    expect(DomainPayloadSchemas[DomainTopic.releaseRegistered].safeParse(history.payload).success).toBe(false);
    const before = await f.snapshot(), items = await f.owner().inspect(f.target);
    expect(items.map(item => item.key)).toEqual(['queue:' + missing]);
    await f.owner().confirm(f.target, f.actor, request(items[0]!));
    expect((await f.owner().inspect(f.target))[0]!.confirmed?.decision).toBe('retain');
    expect(await f.snapshot()).toEqual(before);
  } finally { await f.database.drop(); }
});

test.skipIf(!available)('a missing historical owner requires exact frozen migration reproduction, full references and whole-record retention; changed or unknown sources block it', async () => {
  const f = await operatorRetentionFixture();
  try {
    const history = await historicalEvent(f), before = await f.snapshot(), [item] = await f.owner().inspect(f.target);
    expect(item?.key).toBe('event:' + history.id); expect(item?.allowedDecisions).toEqual(['retain']);
    expect(item?.facts.filter(fact => fact.label.startsWith('历史原引用'))).toHaveLength(3);
    await f.owner().confirm(f.target, f.actor, request(item!));
    expect((await f.owner().inspect(f.target))[0]!.confirmed?.decision).toBe('retain'); expect(await f.snapshot()).toEqual(before);
    const normalization = f.origins.historicalReleaseNormalization!;
    f.origins.historicalReleaseNormalization = async () => ({ ...(history.payload as object), tag: 'substituted' });
    await expect(f.owner().inspect(f.target)).rejects.toThrow(); await expect(f.owner().confirm(f.target, f.actor, request(item!))).rejects.toThrow();
    f.origins.historicalReleaseNormalization = undefined; await expect(f.owner().inspect(f.target)).rejects.toThrow(); f.origins.historicalReleaseNormalization = normalization;
    for (const key of ['active', 'shared'] as const) { f.state[key] = true; expect((await f.owner().inspect(f.target))[0]!.allowedDecisions).toEqual([]); f.state[key] = false; }
    f.state.known = true; expect(await f.owner().inspect(f.target)).toEqual([]); f.state.known = false;
    const changed = { ...history.original, manifest: { ...history.original.manifest, spec: { ...history.original.manifest.spec, unexpected: true } } };
    await f.database.db.execute(sql`UPDATE platform_infra.domain_events SET legacy_payload=${JSON.stringify(changed)}::jsonb,identity_provenance=jsonb_set(identity_provenance,'{originalHash}',${JSON.stringify(jsonHash(changed))}::jsonb) WHERE id=${history.id}::bigint`);
    await expect(f.owner().inspect(f.target)).rejects.toThrow();
    await f.database.db.execute(sql`UPDATE platform_infra.domain_events SET legacy_payload=${JSON.stringify(history.original)}::jsonb,identity_provenance=${JSON.stringify(history.proof)}::jsonb WHERE id=${history.id}::bigint`);
    await f.database.db.execute(sql`INSERT INTO platform_infra.event_dead_letters(consumer,event_id,error) VALUES('historical',${history.id}::bigint,${'hidden target ' + f.target.id})`);
    const withOriginalError = await f.snapshot();
    expect((await f.owner().inspect(f.target))[0]!.allowedDecisions).toEqual([]); await expect(f.owner().confirm(f.target, f.actor, request(item!))).rejects.toThrow();
    expect(await f.snapshot()).toEqual(withOriginalError);
  } finally { await f.database.drop(); }
});
