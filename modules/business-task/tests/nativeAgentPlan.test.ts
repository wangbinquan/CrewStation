import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { BusinessMaterialDto, BusinessSubtaskV3Dto, RunnerBusinessEvent, StoredBusinessExecutionDto } from '@crewstation/contracts';
import { businessAgentDigestInput } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionAgentFixture } from './executionAgentFixture';
import { executionCipher } from '../adapters/crypto/executionCipher';
import { executionSubtasks } from '../adapters/persistence/execution/subtaskTables';
import { drizzleExecutionSubtasks } from '../adapters/persistence/execution/subtasks';
import { drizzleExecutionProjection } from '../adapters/persistence/execution/projection';
import type { ExecutionMaterialObjects } from '../ports/executionMaterials';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-040 frozen Agent plans and inventory projection', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  test('cold dispatch renews grants while native materials, execution identity and digest remain frozen', async () => {
    const f = await executionAgentFixture(tdb.db, undefined, { allowSkills: true, allowSystemPromptAppend: false, allowedEnvNames: [], mcpConnections: [], nativeConfig: { agentDefinitions: true, inlineLocalMcp: true, inlineRemoteMcp: true, plugins: true } });
    const object = { objectId: newResourceId(), sha256: 'a'.repeat(64), size: 1234 }; let issued = 0, pinned = false;
    const objects: ExecutionMaterialObjects = {
      pin: async (_caller, scope) => { expect(scope.objects).toEqual([object]); pinned = true; },
      check: async (scope) => { expect(pinned).toBe(true); expect(scope.objects).toEqual([object]); },
      grants: async (scope) => { expect(pinned).toBe(true); expect(scope.objects).toEqual([object]); issued++; return [{ object, url: 'http://platform.test/internal/material', token: `ephemeral-private-${issued}`, expiresAt: new Date(Date.now() + issued * 60_000).toISOString() }]; },
      release: async () => {},
    };
    const nativeConfig = { version: 1, protocol: 'opencode', agent: { name: 'reviewer', body: 'business root', options: { permission: { bash: 'deny' } } }, subagents: [{ name: 'helper', body: 'business helper' }], plugins: [{ name: 'plugin', entry: 'index.mjs', files: [{ kind: 'file', path: 'index.mjs', object }] }] };
    const api = f.make({ materialObjects: objects });
    const materialReply = await api.request(`/v3/business-tasks/${f.task.id}/materials`, { requestKey: 'native', fence: f.fence, nativeConfig });
    expect(materialReply.status).toBe(201); const material = await materialReply.json() as BusinessMaterialDto;
    const input = { ...f.input, materialId: material.materialId, startupInventoryVersion: 1 }, accepted = await api.request(f.path, input);
    expect(accepted.status).toBe(202); const view = await accepted.json() as BusinessSubtaskV3Dto;
    const row = (await tdb.db.select().from(executionSubtasks).where(eq(executionSubtasks.id, view.id)))[0]!;
    const plan = JSON.parse(await executionCipher(Buffer.alloc(32, 27).toString('base64')).open(row.sealedPayload));
    expect(plan.command.businessNativeConfig).toMatchObject(nativeConfig); expect(plan.command.startupInventoryVersion).toBe(1);
    expect(JSON.stringify(plan)).not.toContain('ephemeral-private'); expect(JSON.stringify(plan)).not.toContain('http://platform.test');
    f.ready(); await f.make({ materialObjects: objects }).module.api.v3.runOnce();
    const sent = f.starts.find(({ command }) => command.type === 'startBusinessAgent')!.command;
    if (sent.type !== 'startBusinessAgent') throw new Error('missing start');
    expect(issued).toBeGreaterThanOrEqual(2); expect(sent.agent.businessMaterialDownloads?.[0]?.token).toBe(`ephemeral-private-${issued}`);
    expect(sent.payloadDigest).toBe(new Bun.CryptoHasher('sha256').update(businessAgentDigestInput(sent.agent, sent.digestNonce)).digest('hex'));
    expect((await f.make({ materialObjects: objects }).request(f.path, input)).status).toBe(200); expect(f.agentBehavior.starts).toBe(1);

    const store = drizzleExecutionSubtasks(tdb.db), projection = drizzleExecutionProjection(tdb.db), current = (await store.get(f.serviceId, f.task.id, view.id))!;
    const at = new Date().toISOString(), inventory = { version: 1 as const, state: 'verified' as const, source: 'opencode-inventory' as const, mcpServers: [{ name: 'docs', status: 'connected' as const }], agents: ['reviewer', 'helper'] };
    const events: RunnerBusinessEvent[] = [
      { sequence: 1, occurredAt: at, frame: { type: 'agent', event: { agentId: view.executionId, seq: 1, at, type: 'startup-inventory', inventory } } },
      { sequence: 2, occurredAt: at, frame: { type: 'agent', event: { agentId: view.executionId, seq: 2, at, type: 'completed', result: { exitCode: 0 } } } },
      { sequence: 3, occurredAt: at, frame: { type: 'result', result: { exitCode: 0, reason: 'exited', durationMs: 12 } } },
    ];
    const snapshot: StoredBusinessExecutionDto = { taskId: f.creates[0]!.id, receipt: { ...f.receipts.get(view.executionId)!, phase: 'finished', lastSequence: 3, result: { exitCode: 0, reason: 'exited', durationMs: 12 } }, complete: true, persistedThrough: 3, acknowledgedThrough: 3 };
    await projection.pending(20);
    await projection.append(current, snapshot, events); await drizzleExecutionProjection(tdb.db).append(current, snapshot, events);
    const page = await (await f.make().request(`/v3/business-tasks/${f.task.id}/events?subtaskId=${view.id}`)).json();
    expect(page.items.filter((event: { type: string }) => event.type === 'startup-inventory')).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ taskId: f.task.id, subtaskId: view.id, attempt: 1, type: 'startup-inventory', data: inventory });
    const final = (await store.get(f.serviceId, f.task.id, view.id))!.view;
    expect(page.items.at(-1).data.finalCursor).toBe(page.items.at(-1).cursor);
    const unfiltered = await projection.events(f.serviceId, f.task.id, { limit: 200 });
    expect(unfiltered.items.at(-1)!.cursor).toBe(final.result!.finalCursor); expect(final.state).toBe('succeeded');
  });
});
