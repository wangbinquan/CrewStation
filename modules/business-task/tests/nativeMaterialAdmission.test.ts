import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import type { BusinessMaterialDto, BusinessSubtaskV3Dto } from '@crewstation/contracts';
import { newResourceId, precondition } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionCommandFixture } from './executionCommandFixture';
import { drizzleExecutionMaterials } from '../adapters/persistence/materials/repository';
import { executionCipher } from '../adapters/crypto/executionCipher';
import { executionSubtasks } from '../adapters/persistence/execution/subtaskTables';
import type { ExecutionMaterialObjects } from '../ports/materials/objects';
import type { ExecutionAgentSecrets } from '../ports/executionAgentSecrets';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-040 durable materials and command secrets', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  test('a lost pin reply leaves a durable unpublished material and cold replay publishes the same identity once', async () => {
    const f = await executionCommandFixture(tdb.db), path = `/v3/business-tasks/${f.task.id}/materials`;
    const held = new Set<string>(), calls: string[] = []; let lost = true;
    const materialObjects: ExecutionMaterialObjects = {
      pin: async (_caller, scope) => {
        const row = await drizzleExecutionMaterials(tdb.db).find(f.serviceId, f.task.id, 'object-material');
        expect(row?.view.materialId).toBe(scope.materialId); expect(row?.state).toBe('preparing');
        held.add(scope.materialId); calls.push(scope.materialId); if (lost) throw new Error('pin reply lost');
      }, check: async () => {}, grants: async () => [],
    };
    const input = { requestKey: 'object-material', fence: f.fence, skills: [{ path: 'review/data.bin', object: { objectId: newResourceId(), sha256: 'a'.repeat(64), size: 2_000_000 } }] };
    expect((await f.make({ materialObjects }).request(path, input)).status).toBe(500);
    const pending = (await drizzleExecutionMaterials(tdb.db).find(f.serviceId, f.task.id, input.requestKey))!;
    expect(pending.state).toBe('preparing'); expect(await drizzleExecutionMaterials(tdb.db).get(f.serviceId, f.task.id, pending.view.materialId)).toBeUndefined();
    lost = false;
    const replies = await Promise.all(Array.from({ length: 3 }, () => f.make({ materialObjects }).request(path, input)));
    expect(replies.every((response) => response.status === 201)).toBe(true);
    const views = await Promise.all(replies.map((response) => response.json() as Promise<BusinessMaterialDto>));
    expect(new Set(views.map((view) => view.materialId))).toEqual(new Set([pending.view.materialId])); expect(held.size).toBe(1);
    expect((await drizzleExecutionMaterials(tdb.db).get(f.serviceId, f.task.id, pending.view.materialId))?.state).toBe('ready');
    expect((await f.make({ materialObjects }).request(path, { ...input, skills: [] })).status).toBe(409);
    const before = calls.length; expect((await f.make({ materialObjects }).request(path, input)).status).toBe(201); expect(calls.length).toBe(before);
  });
  test('new material needs source identity and a current fence and cannot appear ready if object pinning rejects', async () => {
    const f = await executionCommandFixture(tdb.db), path = `/v3/business-tasks/${f.task.id}/materials`;
    const input = { requestKey: 'forbidden-object', fence: f.fence, skills: [{ path: 'review/data', object: { objectId: newResourceId(), sha256: 'a'.repeat(64), size: 1 } }] };
    const objects: ExecutionMaterialObjects = { pin: async () => { throw precondition('对象不属于服务', { code: 'material_object_mismatch' }); }, check: async () => {}, grants: async () => [] };
    const api = f.make({ materialObjects: objects });
    expect((await api.request(path, input, 'invalid')).status).toBe(403);
    expect((await api.request(path, { ...input, fence: undefined })).status).toBe(409);
    expect((await api.request(path, input)).status).toBe(412);
    const row = (await drizzleExecutionMaterials(tdb.db).find(f.serviceId, f.task.id, input.requestKey))!;
    expect(row.state).toBe('preparing'); expect(await drizzleExecutionMaterials(tdb.db).get(f.serviceId, f.task.id, row.view.materialId)).toBeUndefined();
  });
  test('command admission freezes Secret versions, preserves replay through rotation and never persists plaintext', async () => {
    const f = await executionCommandFixture(tdb.db, { agentProfiles: [], compute: { resolve: async () => { throw new Error('unused'); }, launchMaterial: async () => { throw new Error('unused'); } }, commandBusinessConfig: { allowedEnvNames: ['GIT_TOKEN'] } });
    f.behavior.commandSecretEnv = true;
    const definitionId = newResourceId(), itemId = newResourceId(), first = 'private-old-git-token'; let version = 1, versionReads = 0;
    const versions = new Map([[1, first], [2, 'private-rotated-git-token']]);
    const secrets: ExecutionAgentSecrets = {
      versions: async (projectId, ids) => { expect(projectId).toBe(f.projectId); expect(ids).toEqual([definitionId]); versionReads++; return [{ definitionId, itemId, version }]; },
      render: async (projectId, stamps) => { expect(projectId).toBe(f.projectId); return { [definitionId]: versions.get(stamps[0]!.version)! }; },
    };
    const api = f.make({ agentSecrets: secrets }), input = { ...f.input, env: { GIT_TOKEN: { secret: { configDefinitionId: definitionId } } } };
    const response = await api.request(f.path, input); expect(response.status).toBe(201);
    const view = await response.json() as BusinessSubtaskV3Dto;
    const firstCommand = f.commands.find((command) => command.type === 'startBusinessCommand');
    expect(firstCommand).toMatchObject({ type: 'startBusinessCommand', env: { GIT_TOKEN: first }, secretEnvironment: { versions: [{ definitionId, itemId, version: 1 }] } });
    const row = (await tdb.db.select().from(executionSubtasks).where(eq(executionSubtasks.id, view.id)))[0]!;
    expect(JSON.stringify(row)).not.toContain(first);
    const plan = JSON.parse(await executionCipher(Buffer.alloc(32, 27).toString('base64')).open(row.sealedPayload));
    expect(JSON.stringify(plan)).not.toContain(first); expect(plan.secretEnvironment.versions[0].version).toBe(1);
    version = 2; expect((await f.make({ agentSecrets: secrets }).request(f.path, input)).status).toBe(200);
    expect(versionReads).toBe(1); expect(f.behavior.starts).toBe(1);
    // A transport retry after a lost start response keeps the original handle and frozen payload.
    expect((await f.make({ agentSecrets: secrets }).request(f.path, { ...input, name: 'changed' })).status).toBe(409);
  });
  test('old Runner and old release refuse new Secret requests before any process admission', async () => {
    const f = await executionCommandFixture(tdb.db), id = newResourceId();
    const input = { ...f.input, env: { GIT_TOKEN: { secret: { configDefinitionId: id } } } };
    const api = f.make({ agentSecrets: { versions: async () => { throw new Error('must not resolve'); }, render: async () => ({}) } });
    expect((await api.request(f.path, input)).status).toBe(400); expect(f.behavior.starts).toBe(0);
    expect((await tdb.db.execute(sql`SELECT id FROM business_task.execution_subtasks WHERE task_id=${f.task.id}`))).toHaveLength(0);
  });
  test('fresh retry after Secret rotation uses the original versions and missing pinned versions never spawn', async () => {
    const options = { agentProfiles: [], compute: { resolve: async (): Promise<never> => { throw new Error('unused'); }, launchMaterial: async (): Promise<never> => { throw new Error('unused'); } }, commandBusinessConfig: { allowedEnvNames: ['GIT_TOKEN'] } };
    for (const missing of [false, true]) {
      const f = await executionCommandFixture(tdb.db, options); f.behavior.commandSecretEnv = true; f.behavior.disconnectAfterInfo = true;
      const definitionId = newResourceId(), itemId = newResourceId(); let version = 1, reads = 0;
      const secrets: ExecutionAgentSecrets = {
        versions: async () => { reads++; return [{ definitionId, itemId, version }]; },
        render: async (_project, stamps) => { expect(stamps[0]!.version).toBe(1); if (version === 2 && missing) throw new Error('private provider detail'); return { [definitionId]: 'original-secret' }; },
      };
      const api = f.make({ agentSecrets: secrets }), input = { ...f.input, env: { GIT_TOKEN: { secret: { configDefinitionId: definitionId } } } };
      const first = await api.request(f.path, input); expect(first.status).toBe(201); const view = await first.json() as BusinessSubtaskV3Dto;
      expect((await api.request(`${f.path}/${view.id}/cancel`, { requestKey: 'cancel', expectedAttempt: 1, fence: f.fence })).status).toBe(202);
      version = 2; f.behavior.disconnectAfterInfo = false; f.env.connected = true;
      const cold = f.make({ agentSecrets: secrets }), retry = await cold.request(`${f.path}/${view.id}/retry`, { requestKey: 'fresh', expectedAttempt: 1, resumePolicy: 'fresh', fence: f.fence });
      expect(retry.status).toBe(201); const next = await retry.json() as BusinessSubtaskV3Dto;
      expect(next).toMatchObject({ attempt: 2, previousId: view.id }); expect(reads).toBe(1);
      expect(f.behavior.starts).toBe(missing ? 0 : 1);
      if (missing) expect(next).toMatchObject({ state: 'failed', process: 'not-started', error: { code: 'secret_version_unavailable' } });
      else expect(f.commands.find((command) => command.type === 'startBusinessCommand')).toMatchObject({ env: { GIT_TOKEN: 'original-secret' }, secretEnvironment: { versions: [{ version: 1 }] } });
      expect(JSON.stringify(next)).not.toContain('original-secret'); expect(JSON.stringify(next)).not.toContain('private provider detail');
    }
  });
  test('a frozen release allowlist cannot bypass an old Runner capability refusal', async () => {
    const f = await executionCommandFixture(tdb.db, { agentProfiles: [], compute: { resolve: async (): Promise<never> => { throw new Error('unused'); }, launchMaterial: async (): Promise<never> => { throw new Error('unused'); } }, commandBusinessConfig: { allowedEnvNames: ['GIT_TOKEN'] } });
    const api = f.make({ agentSecrets: { versions: async (): Promise<never> => { throw new Error('must not read'); }, render: async () => ({}) } });
    const response = await api.request(f.path, { ...f.input, env: { GIT_TOKEN: { secret: { configDefinitionId: newResourceId() } } } });
    expect(response.status).toBe(412); expect(f.behavior.starts).toBe(0);
  });

});
