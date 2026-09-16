import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, RuntimeCheckId, RuntimeConfigId, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { generateSecretKey } from '@crewstation/secretbox';
import { queueMigrations } from '@crewstation/queue';
import type { Worker } from '@crewstation/queue';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { CheckExecutionInput, CheckOutcome } from '../ports/checkExecutor';
import type { AgentRuntimeModule } from '../wiring';
import { agentRuntimeMigrations, createAgentRuntimeModule } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let mod: AgentRuntimeModule;
const admin: Actor = { userId: 'usr_0123456789abcdef0123456789abcdef' as UserId, isAdmin: true };
const dev: Actor = { userId: 'usr_1123456789abcdef0123456789abcdef' as UserId, isAdmin: false };
const executions: CheckExecutionInput[] = [];
let outcome: (input: CheckExecutionInput) => CheckOutcome = () => ({ state: 'succeeded', stages: [{ id: 'model', kind: 'model', name: '真实模型响应', state: 'succeeded', detail: 'ok' }] });
let references: string[] = [];

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([queueMigrations, agentRuntimeMigrations]);
  mod = createAgentRuntimeModule({
    db: tdb.db, isAdmin: async (id) => id === admin.userId, settings: { secretKeyBase64: generateSecretKey() },
    executor: { run: async (input, report) => { executions.push(input); await report({ context: { image: 'task:test', cliVersion: '1.18.29' } }); return outcome(input); } },
    references: { listReferencing: async () => references },
  });
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('agent-runtime module', () => {
  let id: RuntimeConfigId;

  test('建档预设、草稿保存与版本比较、凭据 keep／replace／clear、GET 无原值', async () => {
    const created = await mod.api.createConfig(admin, { name: 'opencode-gateway', description: '公司网关', driver: 'opencode', preset: 'opencode-config' });
    id = created.id;
    expect(created).toMatchObject({ status: 'draft', draftRevision: 1, activeRevision: null, enabled: true, referencedProfiles: 0 });
    expect(created.draft.secretNames).toEqual(['ANTHROPIC_API_KEY']);
    expect(created.credentials).toEqual([{ name: 'ANTHROPIC_API_KEY', set: false }]);
    await expect(mod.api.createConfig(admin, { name: 'opencode-gateway', description: '', driver: 'opencode', preset: 'blank' })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(mod.api.createConfig(dev, { name: 'x-y-z', description: '', driver: 'opencode', preset: 'blank' })).rejects.toMatchObject({ kind: 'forbidden' });

    const draft = created.draft;
    const saved = await mod.api.saveDraft(admin, id, { expectedRevision: 1, steps: [...draft.steps, { kind: 'script', stepId: 'warm', name: '预热', language: 'shell', source: 'echo warm', argv: [], timeoutMs: 5000 }], vars: { ...draft.vars, EXTRA: 'x' }, secretNames: ['ANTHROPIC_API_KEY', 'SECOND'], credentials: { ANTHROPIC_API_KEY: { op: 'replace', value: 'sk-live-1' } }, configFile: draft.configFile, defaultModel: 'anthropic/claude-x', models: ['anthropic/claude-x'] });
    expect(saved.draftRevision).toBe(2);
    expect(saved.credentials).toEqual([expect.objectContaining({ name: 'ANTHROPIC_API_KEY', set: true, updatedBy: admin.userId }), { name: 'SECOND', set: false }]);
    expect(JSON.stringify(saved)).not.toContain('sk-live-1');
    const stale = mod.api.saveDraft(admin, id, { expectedRevision: 1, steps: draft.steps, vars: draft.vars, secretNames: draft.secretNames, credentials: {}, configFile: draft.configFile, models: [] });
    await expect(stale).rejects.toMatchObject({ kind: 'conflict', details: { code: 'draft_revision_conflict', currentRevision: 2 } });
    await expect(mod.api.saveDraft(admin, id, { expectedRevision: 2, steps: draft.steps, vars: {}, secretNames: draft.secretNames, credentials: {}, configFile: draft.configFile, models: [] })).rejects.toMatchObject({ kind: 'validation', details: { stepId: 'opencode-config' } });
    // keep 保留已有值；clear 删除；未提到的名字保留。
    const kept = await mod.api.saveDraft(admin, id, { expectedRevision: 2, steps: saved.draft.steps, vars: saved.draft.vars, secretNames: ['ANTHROPIC_API_KEY', 'SECOND'], credentials: { ANTHROPIC_API_KEY: { op: 'keep' }, SECOND: { op: 'replace', value: 'two' } }, configFile: draft.configFile, defaultModel: 'anthropic/claude-x', models: ['anthropic/claude-x'] });
    expect(kept.credentials.map((c) => c.set)).toEqual([true, true]);
    // 取消声明并清值在同一次保存完成；已声明但没有值的凭据会让检查在输入阶段失败（见下一条用例的语义）。
    const cleared = await mod.api.saveDraft(admin, id, { expectedRevision: 3, steps: saved.draft.steps, vars: saved.draft.vars, secretNames: ['ANTHROPIC_API_KEY'], credentials: { SECOND: { op: 'clear' } }, configFile: draft.configFile, defaultModel: 'anthropic/claude-x', models: ['anthropic/claude-x'] });
    expect(cleared.credentials.map((c) => [c.name, c.set])).toEqual([['ANTHROPIC_API_KEY', true]]);
    expect(cleared.draftRevision).toBe(4);
    const stored = (await tdb.db.execute(`SELECT name FROM agent_runtime.credentials ORDER BY name`)) as unknown as Array<{ name: string }>;
    expect(stored.map((r) => r.name)).toEqual(['ANTHROPIC_API_KEY']);
    const page = await mod.api.listConfigs(admin, { limit: 20 });
    expect(page.items.map((c) => c.name)).toEqual(['opencode-gateway']);
    await expect(mod.api.getConfig(dev, id)).rejects.toMatchObject({ kind: 'forbidden' });
  });

  test('检查：幂等请求、工作器执行、材料含解密凭据且带 captureOutput；未通过不能启用；编辑后旧检查失效', async () => {
    const request = crypto.randomUUID();
    const check = await mod.api.startCheck(admin, id, { revision: 4, clientRequestId: request });
    expect(check).toMatchObject({ state: 'queued', revision: 4, model: 'anthropic/claude-x' });
    expect((await mod.api.startCheck(admin, id, { revision: 4, clientRequestId: request })).checkId).toBe(check.checkId);
    await expect(mod.api.startCheck(admin, id, { revision: 3, clientRequestId: request })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(mod.api.startCheck(admin, id, { revision: 4, clientRequestId: crypto.randomUUID(), model: 'other/model' })).rejects.toMatchObject({ kind: 'validation' });
    outcome = () => ({ state: 'failed', error: '模型 401', stages: [{ id: 'model', kind: 'model', name: '真实模型响应', state: 'failed', error: { code: 'script_failed', message: '401' } }] });
    expect(await (mod.workers[0] as Worker).runOnce()).toBe(1);
    const failed = await mod.api.getCheck(admin, id, check.checkId);
    expect(failed).toMatchObject({ state: 'failed', error: '模型 401', context: { kind: 'platform-namespace', image: 'task:test', cliVersion: '1.18.29' } });
    expect(failed.stages.find((s) => s.id === 'input')?.state).toBe('succeeded');
    expect(executions.at(-1)?.material).toMatchObject({ revision: 4, secrets: { ANTHROPIC_API_KEY: 'sk-live-1' }, captureOutput: true, driver: 'opencode' });
    expect(executions.at(-1)?.expectedReply).toMatch(/^CREWSTATION_RUNTIME_CHECK_/);
    await expect(mod.api.activate(admin, id, { expectedActiveRevision: null, revision: 4, checkId: check.checkId })).rejects.toMatchObject({ kind: 'precondition', details: { code: 'check_not_usable' } });
    expect((await mod.api.getConfig(admin, id)).status).toBe('check-failed');

    outcome = () => ({ state: 'succeeded', stages: [{ id: 'model', kind: 'model', name: '真实模型响应', state: 'succeeded' }] });
    const passing = await mod.api.startCheck(admin, id, { revision: 4, clientRequestId: crypto.randomUUID() });
    await (mod.workers[0] as Worker).runOnce();
    expect((await mod.api.getConfig(admin, id))).toMatchObject({ status: 'checked', latestCheckId: passing.checkId });
    await expect(mod.api.activate(admin, id, { expectedActiveRevision: 3, revision: 4, checkId: passing.checkId })).rejects.toMatchObject({ kind: 'conflict' });
    const active = await mod.api.activate(admin, id, { expectedActiveRevision: null, revision: 4, checkId: passing.checkId });
    expect(active).toMatchObject({ status: 'active', activeRevision: 4, enabled: true });
    // 编辑草稿不改变已启用版本；旧检查不能启用新版本。
    const edited = await mod.api.saveDraft(admin, id, { expectedRevision: 4, steps: active.draft.steps, vars: { ...active.draft.vars, CHANGED: '1' }, secretNames: active.draft.secretNames, credentials: {}, configFile: active.draft.configFile, defaultModel: 'anthropic/claude-x', models: ['anthropic/claude-x'] });
    expect(edited).toMatchObject({ draftRevision: 5, activeRevision: 4 });
    await expect(mod.api.activate(admin, id, { expectedActiveRevision: 4, revision: 5, checkId: passing.checkId })).rejects.toMatchObject({ kind: 'precondition' });
  });

  test('解析：已启用版本、固定版本、停用与回退；缺凭据指向管理员', async () => {
    const material = await mod.api.resolveActive(id);
    expect(material).toMatchObject({ revision: 4, configName: 'opencode-gateway', captureOutput: false, secrets: { ANTHROPIC_API_KEY: 'sk-live-1' } });
    // 版本 2／3 声明过已清除的 SECOND：按固定版本解析同样要求凭据齐全，只有版本 1 与 4 能取到材料。
    expect((await mod.api.resolveRevision(id, 1)).revision).toBe(1);
    await expect(mod.api.resolveRevision(id, 2)).rejects.toMatchObject({ kind: 'precondition', details: { code: 'runtime_secret_missing', name: 'SECOND' } });
    expect(await mod.api.describeConfig(id)).toEqual({ id, name: 'opencode-gateway', driver: 'opencode', enabled: true, activeRevision: 4 });
    references = ['balanced'];
    expect((await mod.api.getConfig(admin, id)).referencedBy).toEqual(['balanced']);
    await expect(mod.api.disable(admin, id, { expectedActiveRevision: 3 })).rejects.toMatchObject({ kind: 'conflict' });
    const disabled = await mod.api.disable(admin, id, { expectedActiveRevision: 4 });
    expect(disabled).toMatchObject({ status: 'disabled', enabled: false, activeRevision: 4 });
    await expect(mod.api.resolveActive(id)).rejects.toMatchObject({ kind: 'precondition', details: { code: 'runtime_config_disabled' } });
    // 已受理的执行按固定版本继续取材料，停用不影响。
    expect((await mod.api.resolveRevision(id, 4)).revision).toBe(4);
    const check = (await mod.api.getConfig(admin, id)).latestCheckId;
    const revision4Check = (await tdb.db.execute(`SELECT check_id FROM agent_runtime.checks WHERE revision = 4 AND state = 'succeeded'`)) as unknown as Array<{ check_id: string }>;
    const restored = await mod.api.activate(admin, id, { expectedActiveRevision: 4, revision: 4, checkId: revision4Check[0]!.check_id });
    expect(restored).toMatchObject({ status: 'active', enabled: true, activeRevision: 4 });
    expect(check === undefined || typeof check === 'string').toBe(true);
    await expect(mod.api.resolveActive('arc_' + 'f'.repeat(32))).rejects.toMatchObject({ kind: 'precondition', details: { code: 'runtime_config_missing' } });
    const missing = await mod.api.createConfig(admin, { name: 'claude-gateway', description: '', driver: 'claude-code', preset: 'claude-settings' });
    await expect(mod.api.resolveRevision(missing.id, 1)).rejects.toMatchObject({ kind: 'precondition', details: { code: 'runtime_secret_missing', name: 'ANTHROPIC_AUTH_TOKEN' } });
  });

  test('HTTP：管理员接口逐个裁定身份，响应不含密钥', async () => {
    const app = createApp({ name: 'agent-runtime-test' });
    for (const router of mod.http) app.route('/', router);
    const as = (actor: Actor) => ({ [IDENTITY_HEADERS.userId]: actor.userId, [IDENTITY_HEADERS.userName]: 'n', [IDENTITY_HEADERS.userEmail]: 'e@x' });
    expect((await app.request('/v1/admin/agent-runtime-configs', { headers: as(dev) })).status).toBe(403);
    const list = await app.request('/v1/admin/agent-runtime-configs?limit=1', { headers: as(admin) });
    expect(list.status).toBe(200);
    const body = await list.json() as { items: Array<{ name: string }>; nextCursor?: string };
    expect(body.items).toHaveLength(1); expect(body.nextCursor).toBeDefined();
    const detail = await app.request(`/v1/admin/agent-runtime-configs/${id}`, { headers: as(admin) });
    expect(detail.status).toBe(200);
    expect(await detail.text()).not.toContain('sk-live-1');
    const badCheck = await app.request(`/v1/admin/agent-runtime-configs/${id}/checks`, { method: 'POST', headers: { ...as(admin), 'content-type': 'application/json' }, body: JSON.stringify({ revision: 99, clientRequestId: crypto.randomUUID() }) });
    expect(badCheck.status).toBe(404);
    expect((await app.request(`/v1/admin/agent-runtime-configs/${id}/checks/${'chk_' + '0'.repeat(32) as RuntimeCheckId}`, { headers: as(admin) })).status).toBe(404);
  });
});
