import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, CreateComputeProfileRequest, ProfileTestId, UserId } from '@crewstation/contracts';
import { CreateComputeProfileRequestSchema, IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { generateSecretKey } from '@crewstation/secretbox';
import { queueMigrations } from '@crewstation/queue';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { ProfileTestInput, ProfileTestResult } from '../ports/testExecutor';
import type { AgentRuntimeModule } from '../wiring';
import { agentRuntimeMigrations, createAgentRuntimeModule } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let mod: AgentRuntimeModule;
const admin: Actor = { userId: 'usr_0123456789abcdef0123456789abcdef' as UserId, isAdmin: true };
const dev: Actor = { userId: 'usr_1123456789abcdef0123456789abcdef' as UserId, isAdmin: false };
const layout = { pullBase: 'registry.cs.svc:5000', pushHost: 'registry.cs.localhost', baseRepository: 'crewstation/task-runtime', runtimePrefix: 'runtime/' };
const digests = new Map<string, string>([['runtime/glm:1.2', `sha256:${'1'.repeat(64)}`], ['crewstation/task-runtime:dev', `sha256:${'2'.repeat(64)}`], ['runtime/tool:1', `sha256:${'3'.repeat(64)}`]]);
const executions: ProfileTestInput[] = [];
let result: (input: ProfileTestInput) => ProfileTestResult = () => ({ state: 'passed', outcome: 'passed', stages: [{ id: 'model', kind: 'model', name: '真实模型轮次', state: 'succeeded', detail: '回显了测试标记' }] });
let references: string[] = [];
const noHeartbeat = async () => true;

const claude = (patch: Partial<CreateComputeProfileRequest> = {}): CreateComputeProfileRequest => CreateComputeProfileRequestSchema.parse({
  name: 'glm-claude', description: '公司网关的 Claude fork',
  content: {
    image: 'registry.cs.localhost/runtime/glm:1.2', launch: { protocol: 'claude-code', binaryPath: '/opt/glm/bin/claude', extraArgs: ['--skip-safe-check'], model: 'glm-4.6' },
    steps: [{ kind: 'file', stepId: 'settings', name: 'settings.json', pathTemplate: '{{agent.home}}/.claude/settings.json', format: 'json', contentTemplate: '{"env":{"ANTHROPIC_AUTH_TOKEN":"{{secrets.TOKEN}}"}}' }],
    secretNames: ['TOKEN'], configFile: { kind: 'claude-settings', pathTemplate: '{{agent.home}}/.claude/settings.json' },
  },
  credentials: { TOKEN: { op: 'replace', value: 'sk-live-1' } },
  ...patch,
});
const terminal = (): CreateComputeProfileRequest => CreateComputeProfileRequestSchema.parse({
  name: 'codex-term', content: { image: 'runtime/tool:1', launch: { protocol: 'terminal', binaryPath: '/opt/tool/bin/tool' }, terminalTest: { command: ['/opt/tool/bin/tool', '--version'], expect: '^tool' } },
});
/** 让排队的测试跑到终态：测试作业工作器在真实部署里做的事。 */
async function drainTests(name: string): Promise<void> {
  const detail = await mod.api.getProfile(admin, name);
  if (detail.latestTest && detail.latestTest.state === 'queued') await mod.api.runQueuedTest(detail.latestTest.testId as ProfileTestId, noHeartbeat);
}

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([queueMigrations, agentRuntimeMigrations]);
  mod = createAgentRuntimeModule({
    db: tdb.db, isAdmin: async (id) => id === admin.userId,
    settings: { secretKeyBase64: generateSecretKey(), registry: { ...layout, scheme: 'http', baseTag: 'dev' } },
    registry: { layout, resolveDigest: async (repository, ref) => { const d = digests.get(`${repository}:${ref.tag}`); if (!d) throw Object.assign(new Error('missing'), { kind: 'validation' }); return d; } },
    executor: { run: async (input, report) => { executions.push(input); await report({ context: { imageDigest: input.image.split('@')[1], runnerProtocol: 2 } }); return result(input); } },
    references: { listReferencingProjects: async () => references },
    taskProfiles: { exists: async (name) => name === 'cli-small' },
  });
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('算力档位模块（RFC-006）', () => {
  test('建档：镜像规范化并按摘要固定、凭据只回「已设置」、自动排测试；测试通过前租户不可选', async () => {
    const created = await mod.api.createProfile(admin, claude());
    expect(created).toMatchObject({ name: 'glm-claude', protocol: 'claude-code', revision: 1, image: 'registry.cs.svc:5000/runtime/glm:1.2', imageDigest: digests.get('runtime/glm:1.2'), binaryPath: '/opt/glm/bin/claude', model: 'glm-4.6', enabled: true, isDefault: false });
    expect(created.credentials).toEqual([expect.objectContaining({ name: 'TOKEN', set: true, updatedBy: admin.userId })]);
    expect(JSON.stringify(created)).not.toContain('sk-live-1');
    expect(created.latestTest).toMatchObject({ state: 'queued', trigger: 'save', revision: 1 });
    expect(created.availability).toMatchObject({ state: 'testing', available: false });
    expect((await mod.api.listSummaries()).find((s) => s.name === 'glm-claude')).toMatchObject({ available: false, terminalOnly: false });
    await expect(mod.api.resolve('glm-claude', 'agent')).rejects.toMatchObject({ kind: 'precondition', details: { code: 'profile_unavailable', state: 'testing' } });
    await expect(mod.api.createProfile(admin, claude())).rejects.toMatchObject({ kind: 'conflict' });
    await expect(mod.api.createProfile(dev, claude({ name: 'other-one' }))).rejects.toMatchObject({ kind: 'forbidden' });
  });

  test('测试作业：用固定摘要的镜像、解密后的凭据与 nonce 提示；通过后可选', async () => {
    await drainTests('glm-claude');
    const input = executions.at(-1)!;
    expect(input.image).toBe(`registry.cs.svc:5000/runtime/glm@${digests.get('runtime/glm:1.2')}`);
    expect(input.beforeStart).toMatchObject({ profile: 'glm-claude', revision: 1, captureOutput: true, secrets: { TOKEN: 'sk-live-1' } });
    expect(input.launch).toMatchObject({ protocol: 'claude-code', binaryPath: '/opt/glm/bin/claude', extraArgs: ['--skip-safe-check'] });
    expect(input.prompt).toContain(input.expectedReply);
    const detail = await mod.api.getProfile(admin, 'glm-claude');
    expect(detail.latestTest).toMatchObject({ state: 'passed', outcome: 'passed', context: { runnerProtocol: 2 } });
    expect(detail.availability).toEqual({ state: 'ready', available: true });
    expect(await mod.api.resolve('glm-claude', 'subtask')).toMatchObject({ name: 'glm-claude', revision: 1, protocol: 'claude-code', image: input.image });
  });

  test('保存：只改说明不生成修订也不重测（P3）；执行内容或凭据变化生成新修订并自动测试；旧 expectedRevision 409', async () => {
    const before = await mod.api.getProfile(admin, 'glm-claude');
    const same = await mod.api.saveProfile(admin, 'glm-claude', { expectedRevision: 1, description: '只改说明', content: before.content, credentials: {} });
    expect(same).toMatchObject({ revision: 1, description: '只改说明', availability: { state: 'ready' } });
    const rotated = await mod.api.saveProfile(admin, 'glm-claude', { expectedRevision: 1, content: before.content, credentials: { TOKEN: { op: 'replace', value: 'sk-live-2' } } });
    expect(rotated).toMatchObject({ revision: 2, availability: { state: 'testing' }, latestTest: { revision: 2, state: 'queued' } });
    await expect(mod.api.saveProfile(admin, 'glm-claude', { expectedRevision: 1, content: before.content, credentials: {} })).rejects.toMatchObject({ kind: 'conflict', details: { code: 'profile_revision_conflict', currentRevision: 2 } });
    await expect(mod.api.saveProfile(admin, 'glm-claude', { expectedRevision: 2, content: { ...before.content, launch: { ...before.content.launch, protocol: 'opencode' } } as never, credentials: {} })).rejects.toMatchObject({ kind: 'validation' });
    await expect(mod.api.saveProfile(admin, 'glm-claude', { expectedRevision: 2, content: { ...before.content, image: 'docker.io/library/ubuntu:24.04' }, credentials: {} })).rejects.toMatchObject({ kind: 'validation', details: { field: 'content.image' } });
    await expect(mod.api.saveProfile(admin, 'glm-claude', { expectedRevision: 2, content: { ...before.content, taskProfile: 'nope' }, credentials: {} })).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('新修订产生时旧修订未结束的测试作废；已受理的旧修订仍能按固定修订取材料', async () => {
    const r2 = await mod.api.getProfile(admin, 'glm-claude');
    const content = { ...r2.content, launch: { ...r2.content.launch, model: 'glm-4.7' } };
    await mod.api.saveProfile(admin, 'glm-claude', { expectedRevision: 2, content, credentials: {} });
    const stale = await mod.api.getTest(admin, 'glm-claude', r2.latestTest!.testId as ProfileTestId);
    expect(stale.state).toBe('superseded');
    await mod.api.runQueuedTest(stale.testId as ProfileTestId, noHeartbeat);
    expect((await mod.api.getTest(admin, 'glm-claude', stale.testId as ProfileTestId)).state).toBe('superseded');
    const material = await mod.api.launchMaterial({ profile: 'glm-claude', revision: 1 });
    expect(material).toMatchObject({ revision: 1, launch: { model: 'glm-4.6' }, beforeStart: { revision: 1, captureOutput: false, secrets: { TOKEN: 'sk-live-2' } } });
    await drainTests('glm-claude');
  });

  test('测试失败：给出可读原因，租户不可选；手动重测按 clientRequestId 幂等', async () => {
    result = () => ({ state: 'failed', outcome: 'network-blocked', error: 'connect ECONNREFUSED', stages: [] });
    const detail = await mod.api.getProfile(admin, 'glm-claude');
    const clientRequestId = crypto.randomUUID();
    const started = await mod.api.startTest(admin, 'glm-claude', { clientRequestId });
    expect(await mod.api.startTest(admin, 'glm-claude', { clientRequestId })).toMatchObject({ testId: started.testId });
    await mod.api.runQueuedTest(started.testId as ProfileTestId, noHeartbeat);
    const failed = await mod.api.getProfile(admin, 'glm-claude');
    expect(failed.revision).toBe(detail.revision);
    expect(failed.availability).toMatchObject({ state: 'test-failed', available: false });
    expect(failed.availability.reason).toContain('连不上模型端点');
    await expect(mod.api.resolve('glm-claude', 'cli')).rejects.toMatchObject({ kind: 'precondition', details: { code: 'profile_unavailable' } });
    result = () => ({ state: 'passed', outcome: 'passed', stages: [] });
    const again = await mod.api.startTest(admin, 'glm-claude', { clientRequestId: crypto.randomUUID() });
    await mod.api.runQueuedTest(again.testId as ProfileTestId, noHeartbeat);
    expect((await mod.api.getProfile(admin, 'glm-claude')).availability.available).toBe(true);
  });

  test('通用终端档位：只能用于「＋ CLI」，不能设为默认；测试输入带测试命令', async () => {
    await mod.api.createProfile(admin, terminal());
    await drainTests('codex-term');
    expect(executions.at(-1)).toMatchObject({ terminalTest: { command: ['/opt/tool/bin/tool', '--version'], expect: '^tool' } });
    expect(await mod.api.resolve('codex-term', 'cli')).toMatchObject({ protocol: 'terminal' });
    await expect(mod.api.resolve('codex-term', 'agent')).rejects.toMatchObject({ kind: 'validation', details: { code: 'terminal_profile_not_allowed' } });
    await expect(mod.api.setDefault(admin, 'codex-term')).rejects.toMatchObject({ kind: 'conflict', details: { code: 'terminal_profile_not_allowed' } });
    expect((await mod.api.listSummaries()).find((s) => s.name === 'codex-term')).toMatchObject({ terminalOnly: true, available: true });
    expect(await mod.api.lookupForRelease('codex-term')).toEqual({ name: 'codex-term', terminalOnly: true });
  });

  test('default：未设置时拒绝；设置后每次启动解析到当前默认；默认不能停用或删除；改默认后下一次就换', async () => {
    await expect(mod.api.resolve(undefined, 'agent')).rejects.toMatchObject({ kind: 'precondition', details: { code: 'no_default_profile' } });
    expect(await mod.api.lookupForRelease('default')).toBeUndefined();
    await mod.api.setDefault(admin, 'glm-claude');
    expect(await mod.api.resolve('default', 'subtask')).toMatchObject({ name: 'glm-claude' });
    expect(await mod.api.lookupForRelease('default')).toEqual({ name: 'glm-claude', terminalOnly: false });
    await expect(mod.api.setEnabled(admin, 'glm-claude', false)).rejects.toMatchObject({ kind: 'conflict', details: { code: 'default_profile_locked' } });
    await expect(mod.api.removeProfile(admin, 'glm-claude', true)).rejects.toMatchObject({ kind: 'conflict', details: { code: 'default_profile_locked' } });
    await mod.api.copyProfile(admin, 'glm-claude', { name: 'glm-claude-2' });
    await drainTests('glm-claude-2');
    await mod.api.setDefault(admin, 'glm-claude-2');
    expect(await mod.api.resolve(undefined, 'agent')).toMatchObject({ name: 'glm-claude-2' });
    expect((await mod.api.listProfiles(admin)).items.filter((p) => p.isDefault).map((p) => p.name)).toEqual(['glm-claude-2']);
  });

  test('复制：内容与凭据密文相同、名字新、独立测试；停用只阻止新受理', async () => {
    const copy = await mod.api.getProfile(admin, 'glm-claude-2');
    expect(copy.credentials).toEqual([expect.objectContaining({ name: 'TOKEN', set: true })]);
    expect((await mod.api.launchMaterial({ profile: 'glm-claude-2', revision: 1 })).beforeStart.secrets).toEqual({ TOKEN: 'sk-live-2' });
    await mod.api.setEnabled(admin, 'glm-claude', false);
    await expect(mod.api.resolve('glm-claude', 'agent')).rejects.toMatchObject({ details: { code: 'profile_unavailable', state: 'disabled' } });
    expect((await mod.api.launchMaterial({ profile: 'glm-claude', revision: 3 })).revision).toBe(3);
    await expect(mod.api.setDefault(admin, 'glm-claude')).rejects.toMatchObject({ kind: 'conflict', details: { code: 'profile_disabled' } });
    await mod.api.setEnabled(admin, 'glm-claude', true);
  });

  test('删除：被已上线版本引用时先 409 列出项目，确认后删除；删除后固定修订取材料明确失败', async () => {
    references = ['proj-a', 'proj-b'];
    await expect(mod.api.removeProfile(admin, 'glm-claude', false)).rejects.toMatchObject({ kind: 'conflict', details: { code: 'profile_referenced', projects: ['proj-a', 'proj-b'] } });
    await mod.api.removeProfile(admin, 'glm-claude', true);
    references = [];
    await expect(mod.api.getProfile(admin, 'glm-claude')).rejects.toMatchObject({ kind: 'not_found' });
    await expect(mod.api.launchMaterial({ profile: 'glm-claude', revision: 1 })).rejects.toMatchObject({ kind: 'precondition', details: { code: 'profile_revision_missing' } });
    await expect(mod.api.resolve('glm-claude', 'agent')).rejects.toMatchObject({ kind: 'validation', details: { code: 'profile_not_found' } });
  });

  test('HTTP：管理接口只对管理员开放、响应无凭据原值；租户目录任何登录用户可读且不含镜像与模型', async () => {
    const app = createApp({ name: 'agent-runtime-test' });
    for (const router of mod.http) app.route('/', router);
    const as = (actor: Actor) => ({ [IDENTITY_HEADERS.userId]: actor.userId, [IDENTITY_HEADERS.userName]: 'n', [IDENTITY_HEADERS.userEmail]: 'e@x' });
    expect((await app.request('/v1/admin/compute-profiles', { headers: as(dev) })).status).toBe(403);
    const list = await app.request('/v1/admin/compute-profiles', { headers: as(admin) });
    expect(list.status).toBe(200);
    expect(JSON.stringify(await list.json())).not.toContain('sk-live');
    const catalog = await (await app.request('/v1/catalog/compute-profiles', { headers: as(dev) })).json() as { items: Array<Record<string, unknown>> };
    expect(catalog.items.map((i) => Object.keys(i).sort())).toContainEqual(['available', 'description', 'isDefault', 'name', 'terminalOnly']);
    expect(JSON.stringify(catalog)).not.toContain('/opt/');
    const refused = await app.request('/v1/admin/compute-profiles/glm-claude-2', { method: 'DELETE', headers: as(admin) });
    expect(refused.status).toBe(409);
  });

  test('HTTP：保存与复制不带说明时保留原说明（缺省不能被解析成空串；2026-09-18 实机发现）', async () => {
    const app = createApp({ name: 'agent-runtime-test' });
    for (const router of mod.http) app.route('/', router);
    const headers = { [IDENTITY_HEADERS.userId]: admin.userId, [IDENTITY_HEADERS.userName]: 'n', [IDENTITY_HEADERS.userEmail]: 'e@x', 'content-type': 'application/json' };
    const before = await mod.api.getProfile(admin, 'glm-claude-2');
    await mod.api.saveProfile(admin, 'glm-claude-2', { expectedRevision: before.revision, description: '保留这段说明', content: before.content, credentials: {} });
    const saved = await app.request('/v1/admin/compute-profiles/glm-claude-2', { method: 'PUT', headers, body: JSON.stringify({ expectedRevision: before.revision, content: before.content }) });
    expect(saved.status).toBe(200);
    expect((await mod.api.getProfile(admin, 'glm-claude-2')).description).toBe('保留这段说明');
    const copied = await app.request('/v1/admin/compute-profiles/glm-claude-2/copy', { method: 'POST', headers, body: JSON.stringify({ name: 'glm-claude-3' }) });
    expect(copied.status).toBe(201);
    expect((await mod.api.getProfile(admin, 'glm-claude-3')).description).toBe('保留这段说明');
  });

  test('镜像页与推送凭据：底座按摘要给出示例 Dockerfile；凭据只给管理员、只在签发响应里出现；仓库 ForwardAuth 只放行前缀内推拉（C18）', async () => {
    const app = createApp({ name: 'agent-runtime-test' });
    for (const router of [...mod.http, ...mod.forwardAuth]) app.route('/', router);
    const as = (actor: Actor) => ({ [IDENTITY_HEADERS.userId]: actor.userId, [IDENTITY_HEADERS.userName]: 'n', [IDENTITY_HEADERS.userEmail]: 'e@x' });
    const info = await (await app.request('/v1/admin/runtime-images', { headers: as(admin) })).json() as Record<string, unknown>;
    expect(info).toMatchObject({ pushHost: 'registry.cs.localhost', repositoryPrefix: 'runtime/', pullReference: 'registry.cs.svc:5000/runtime/',
      baseImage: { reference: 'registry.cs.svc:5000/crewstation/task-runtime:dev', pushHostReference: 'registry.cs.localhost/crewstation/task-runtime:dev', digest: `sha256:${'2'.repeat(64)}` } });
    expect(info.sampleDockerfile).toContain(`FROM registry.cs.localhost/crewstation/task-runtime@sha256:${'2'.repeat(64)}`);
    expect((await app.request('/v1/admin/runtime-images/credentials', { method: 'POST', headers: as(dev) })).status).toBe(403);
    const issued = await app.request('/v1/admin/runtime-images/credentials', { method: 'POST', headers: as(admin) });
    expect(issued.status).toBe(201);
    expect(issued.headers.get('cache-control')).toBe('no-store');
    const credential = await issued.json() as { username: string; password: string; pushPrefixes: string[]; pullPrefixes: string[] };
    expect(credential).toMatchObject({ username: admin.userId, pushPrefixes: ['runtime/'], pullPrefixes: ['runtime/', 'crewstation/task-runtime'] });
    const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
    const auth = (method: string, uri: string, authorization?: string) => app.request('/forward-auth/registry', { headers: { 'x-forwarded-method': method, 'x-forwarded-uri': uri, ...(authorization ? { authorization } : {}) } });
    const good = basic(credential.username, credential.password);
    expect((await auth('GET', '/v2/')).status).toBe(401);
    expect((await auth('GET', '/v2/')).headers.get('www-authenticate')).toContain('Basic');
    expect((await auth('GET', '/v2/', good)).status).toBe(200);
    expect((await auth('PUT', '/v2/runtime/glm/manifests/1.3', good)).status).toBe(200);
    expect((await auth('PATCH', '/v2/runtime/glm/blobs/uploads/abc?_state=x', good)).status).toBe(200);
    expect((await auth('GET', '/v2/crewstation/task-runtime/manifests/dev', good)).status).toBe(200);
    expect((await auth('PUT', '/v2/crewstation/task-runtime/manifests/dev', good)).status).toBe(403);
    expect((await auth('DELETE', '/v2/runtime/glm/manifests/sha256:abc', good)).status).toBe(403);
    expect((await auth('GET', '/v2/_catalog', good)).status).toBe(403);
    expect((await auth('GET', '/v2/other/app/manifests/1', good)).status).toBe(403);
    expect((await auth('GET', '/v2/', basic('usr_someone-else', credential.password))).status).toBe(401);
    expect((await auth('GET', '/v2/', basic(credential.username, `${credential.password.slice(0, -2)}xx`))).status).toBe(401);
  });
});
