import { expect, test } from 'bun:test';
import type { Actor, ProjectDeletionTarget } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { queueMigrations, readQueueContents } from '@crewstation/queue';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { readMigrationDir } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { provisioningOperatorRepairs, retainedProvisionContent } from '../adapters/persistence/operatorRepairs';
import type { InfrastructureOriginSources } from '../ports/infrastructureOrigins';

const available = await testDatabaseAvailable();
test.skipIf(!available)('only individually reviewed terminal retired-profile queue bodies are retained; owner remains unknown and whole-row/evidence changes invalidate', async () => {
  const database = await createTestDatabase([queueMigrations, eventbusMigrations, { module: 'provisioning', layer: 6, files: readMigrationDir(new URL('../adapters/persistence/migrations', import.meta.url).pathname) }]), id = newResourceId(), project = newResourceId(), actor: Actor = { userId: newResourceId() as Actor['userId'], isAdmin: true };
  const target = { id: project, slug: 'target', namespace: 'cs-target' } as ProjectDeletionTarget; let retired = true, active = false;
  const origins: InfrastructureOriginSources = { resolve: async () => undefined,
    currentProfileTestEvidence: async (key) => ({ complete: true, id: key, retired, active: false, aliases: [], digest: jsonHash({ retired }) }),
    currentAssets: { inspect: async () => ({ complete: true, digest: jsonHash({ active }), activeConsumers: active ? ['consumer'] : [], targetReferences: [] }) } };
  try {
    await database.db.execute(sql`INSERT INTO platform_infra.jobs(kind,payload,state) VALUES('agent-runtime.profile-test',${JSON.stringify({ testId: id })}::jsonb,'done'),('unrelated', '{}'::jsonb,'done')`);
    const [row] = await readQueueContents(database.db, null, 200, 'agent-runtime.profile-test'), owner = () => provisioningOperatorRepairs(database.db, origins);
    const original = { id: row!.id, birthDigest: row!.birthDigest, contentDigest: row!.contentDigest, deadLetters: 0, document: { channel: 'queue' as const, name: row!.kind, payload: row!.payload, legacyPayload: row!.legacyPayload, identityProvenance: row!.identityProvenance } };
    expect(await retainedProvisionContent(database.db, origins, target, original)).toBeUndefined();
    const [item] = await owner().inspect(target); expect(item!.allowedDecisions).toEqual(['retain']);
    const request = { owner: item!.owner, key: item!.key, originalDigest: item!.originalDigest, evidenceDigest: item!.evidenceDigest, decision: 'retain' as const };
    await expect(owner().confirm(target, { ...actor, isAdmin: false }, request)).rejects.toThrow();
    expect((await owner().confirm(target, actor, request)).confirmed?.actorId).toBe(actor.userId);
    expect(await retainedProvisionContent(database.db, origins, target, original)).toMatch(/^[a-f0-9]{64}$/);
    expect((await readQueueContents(database.db, null, 200, row!.kind))[0]).toEqual(row!);
    expect(await origins.resolve(original.document, { kind: 'profile-test', key: id }, 'current')).toBeUndefined();
    retired = false; expect((await owner().inspect(target))[0]!.allowedDecisions).toEqual(['retain']); expect((await owner().inspect(target))[0]!.confirmed).toBeNull(); expect(await retainedProvisionContent(database.db, origins, target, original)).toBeUndefined(); retired = true;
    active = true; await expect(owner().confirm(target, actor, request)).rejects.toThrow(); active = false;
    await database.db.execute(sql`UPDATE platform_infra.jobs SET last_error='changed-whole-row' WHERE id=${row!.id}::bigint`);
    expect(await retainedProvisionContent(database.db, origins, target, original)).toBeUndefined(); expect((await owner().inspect(target))[0]!.confirmed).toBeNull();
    await expect(owner().confirm(target, actor, request)).rejects.toThrow();
    await expect(readQueueContents(database.db, null, 200, '')).rejects.toThrow('kind');
    await expect(database.db.execute(sql`DELETE FROM provisioning.operator_confirmations`).then(() => undefined)).rejects.toThrow();
  } finally { await database.drop(); }
});
