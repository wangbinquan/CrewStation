import { ComputeProfileContentSchema, ComputeProfileDetailDtoSchema, ProfileTestDtoSchema } from '@crewstation/contracts';
import type { ComputeProfileDetailDto, ProfileTestDto } from '@crewstation/contracts';

/** 算力档位（RFC-006）管理页测试的假后端：只在 HTTP 边界替换，页面走真实路由、Query 与 api-client。 */
export const ADMIN_ID = `usr_${'a'.repeat(32)}`;
export const TASK_ID = `tsk_${'3'.repeat(32)}`;
export const testIdOf = (n: number) => `pft_${String(n).repeat(32).slice(0, 32)}`;
export const DIGEST = `sha256:${'ab12cd34ef56'.repeat(5)}abcd`;
const AT = '2026-09-17T08:00:00.000Z';
const SETTINGS_PATH = '{{agent.home}}/.claude/settings.json';

/** 覆写值不带品牌类型：夹具最终都过一遍契约 schema，写错的字段在夹具里就失败。 */
type Loose<T> = { readonly [K in keyof T]?: unknown };

export function profileTest(overrides: Loose<ProfileTestDto> = {}): ProfileTestDto {
  return ProfileTestDtoSchema.parse({
    testId: testIdOf(1), profile: 'claude-daily', revision: 1, contentHash: 'c0ffee00c0ffee00c0ffee', trigger: 'save', state: 'passed', outcome: 'passed',
    stages: [
      { id: 'image', kind: 'image', name: '拉取镜像', state: 'succeeded', durationMs: 1200 },
      { id: 'runner', kind: 'runner', name: 'Runner 握手', state: 'succeeded', durationMs: 40 },
      { id: 'step:claude-settings', kind: 'step', stepId: 'claude-settings', name: 'Claude settings.json', state: 'succeeded', durationMs: 5 },
      { id: 'launch', kind: 'launch', name: '启动 CLI', state: 'succeeded', durationMs: 300 },
      { id: 'model', kind: 'model', name: '模型轮次', state: 'succeeded', durationMs: 2100, detail: '回文：OK' },
    ],
    context: { kind: 'platform-namespace', taskId: TASK_ID, image: 'registry.cs.local/runtimes/claude:2.1', imageDigest: DIGEST, runnerProtocol: 2, cliVersion: '2.1.4', interpreters: [{ language: 'shell', command: 'bash', version: '5.2' }] },
    createdBy: ADMIN_ID, createdAt: AT, endedAt: AT,
    ...overrides,
  });
}

type DetailOverrides = Loose<Omit<ComputeProfileDetailDto, 'content'>> & { readonly content?: Loose<ComputeProfileDetailDto['content']> };

/** 一个可用的 Claude Code 协议档位；各测试只覆写关心的字段。 */
export function profileDetail(overrides: DetailOverrides = {}): ComputeProfileDetailDto {
  const { content, ...rest } = overrides;
  return ComputeProfileDetailDtoSchema.parse({
    name: 'claude-daily', protocol: 'claude-code', description: '日常开发', enabled: true, isDefault: false, revision: 1,
    image: 'registry.cs.local/runtimes/claude:2.1', imageDigest: DIGEST, binaryPath: '/usr/local/bin/claude', model: 'anthropic/claude-sonnet-5',
    availability: { state: 'ready', available: true }, latestTest: profileTest(), updatedBy: ADMIN_ID, updatedAt: AT,
    content: {
      image: 'registry.cs.local/runtimes/claude:2.1',
      launch: { protocol: 'claude-code', binaryPath: '/usr/local/bin/claude', extraArgs: [], isSandbox: false, model: 'anthropic/claude-sonnet-5' },
      steps: [{ kind: 'file', stepId: 'claude-settings', name: 'Claude settings.json', pathTemplate: SETTINGS_PATH, contentTemplate: '{"env":{"ANTHROPIC_AUTH_TOKEN":"{{secrets.ANTHROPIC_AUTH_TOKEN}}"}}', format: 'json', mode: 0o600, existing: 'require-same' }],
      vars: {}, secretNames: ['ANTHROPIC_AUTH_TOKEN'], configFile: { kind: 'claude-settings', pathTemplate: SETTINGS_PATH },
      ...content,
    },
    contentHash: 'c0ffee00c0ffee00c0ffee', credentials: [{ name: 'ANTHROPIC_AUTH_TOKEN', set: true }], referencedBy: [], createdBy: ADMIN_ID, createdAt: AT,
    ...rest,
  });
}

/** 通用终端协议的档位：只能用于「＋ CLI」，不能设为默认。 */
export function terminalProfile(overrides: DetailOverrides = {}): ComputeProfileDetailDto {
  return profileDetail({
    name: 'aider-shell', protocol: 'terminal', description: '终端 CLI', binaryPath: '/opt/aider/bin/aider', model: undefined, latestTest: undefined,
    availability: { state: 'untested', available: false, reason: '尚未测试' }, credentials: [],
    ...overrides,
    content: {
      image: 'registry.cs.local/runtimes/aider:1', launch: { protocol: 'terminal', binaryPath: '/opt/aider/bin/aider', extraArgs: [], isSandbox: false }, steps: [], secretNames: [], configFile: { kind: 'none' },
      terminalTest: { command: ['/opt/aider/bin/aider', '--version'], expect: '^aider', timeoutMs: 30_000 }, ...overrides.content,
    },
  });
}

export const RUNTIME_IMAGES = {
  pushHost: 'registry.cs.local:5443', repositoryPrefix: 'runtimes/', pullReference: 'registry.cs.local/runtimes',
  baseImage: { reference: 'registry.cs.local/crewstation/task:0.9.0', pushHostReference: 'registry.cs.local:5443/crewstation/task:0.9.0', digest: DIGEST },
  sampleDockerfile: 'FROM registry.cs.local:5443/crewstation/task:0.9.0\nCOPY my-cli /opt/my-cli\n',
};

export const PUSH_CREDENTIAL = { pushHost: 'registry.cs.local:5443', username: 'push-7f3a', password: 'one-time-secret-9b2', expiresAt: '2026-09-17T20:00:00.000Z', pushPrefixes: ['runtimes/'], pullPrefixes: ['runtimes/', 'crewstation/task'] };

export interface RecordedWrite { readonly method: string; readonly path: string; readonly query: string; readonly body: Record<string, unknown> }

const json = (body: unknown, status = 200) => Response.json(body, { status });
const conflict = (message: string, details: Record<string, unknown>) => json({ error: 'conflict', message, details }, 409);
const queuedTest = (profile: string, revision: number) => profileTest({ testId: testIdOf(revision + 1), profile, revision, state: 'queued', outcome: undefined, stages: [], endedAt: undefined });

/**
 * 假后端的状态完全暴露给测试：profiles 是服务端当前内容；saveConflict 让保存返回 409；
 * manualTests 是手动测试的时间线——发起时返回第一条，之后每次查询前进一条并停在最后一条。
 * 写请求逐条记录，断言请求体而不是界面猜测。
 */
export function computeBackend(initial: readonly ComputeProfileDetailDto[] = [profileDetail({ isDefault: true })]) {
  const state = { profiles: [...initial], saveConflict: undefined as number | undefined, manualTests: [] as ProfileTestDto[], testCursor: 0 };
  const writes: RecordedWrite[] = [];
  const replace = (next: ComputeProfileDetailDto) => { state.profiles = state.profiles.map((p) => (p.name === next.name ? next : p)); return next; };
  const create = (body: Record<string, unknown>) => {
    const content = ComputeProfileContentSchema.parse(body.content), name = String(body.name);
    const created = profileDetail({ name, description: body.description, protocol: content.launch.protocol, image: content.image, binaryPath: content.launch.binaryPath, model: content.launch.model,
      availability: { state: 'testing', available: false, reason: '测试中' }, latestTest: queuedTest(name, 1), content, credentials: content.secretNames.map((secret) => ({ name: secret, set: true })) });
    state.profiles.push(created);
    return json(created, 201);
  };
  const save = (profile: ComputeProfileDetailDto, body: Record<string, unknown>) => {
    if (state.saveConflict !== undefined) return conflict('档位已被修改', { code: 'revision_conflict', currentRevision: state.saveConflict });
    const content = ComputeProfileContentSchema.parse(body.content), changed = JSON.stringify(content) !== JSON.stringify(profile.content), revision = profile.revision + 1;
    const executed = changed ? { content, revision, availability: { state: 'testing' as const, available: false, reason: '测试中' }, latestTest: queuedTest(profile.name, revision) } : {};
    return json(replace({ ...profile, description: String(body.description ?? profile.description), ...executed }));
  };
  const remove = (profile: ComputeProfileDetailDto, query: string) => {
    if (profile.referencedBy.length > 0 && !query.includes('confirmReferences=true')) return conflict('档位仍被引用', { code: 'profile_referenced', projects: profile.referencedBy });
    state.profiles = state.profiles.filter((p) => p.name !== profile.name);
    return new Response(null, { status: 204 });
  };
  const profileRoute = (method: string, sub: string, query: string, body: Record<string, unknown>, profile: ComputeProfileDetailDto): Response => {
    if (sub === '') return method === 'GET' ? json(profile) : method === 'PUT' ? save(profile, body) : remove(profile, query);
    if (sub === 'enabled') return profile.isDefault && body.enabled === false ? conflict('默认档位不能停用', { code: 'default_profile' }) : json(replace({ ...profile, enabled: body.enabled === true }));
    if (sub === 'default') { state.profiles = state.profiles.map((p) => ({ ...p, isDefault: p.name === profile.name })); return json(state.profiles.find((p) => p.name === profile.name)); }
    if (sub === 'copy') { const copy = { ...profile, name: String(body.name), isDefault: false, revision: 1 }; state.profiles.push(copy); return json(copy, 201); }
    if (sub === 'tests' && method === 'POST') { state.testCursor = 0; return json(state.manualTests[0], 202); }
    if (sub.startsWith('tests/')) { state.testCursor = Math.min(state.testCursor + 1, state.manualTests.length - 1); return json(state.manualTests[state.testCursor]); }
    return json({ error: 'not_found', message: `未知路径 ${sub}`, details: {} }, 404);
  };
  const route = (method: string, path: string, query: string, body: Record<string, unknown>): Response => {
    if (path === '/v1/me') return json({ id: ADMIN_ID, name: '王管理', email: 'admin@test.invalid', isAdmin: true, memberships: [], authMethod: 'password' });
    if (path === '/v1/users') return json({ items: [{ id: ADMIN_ID, name: '王管理', email: 'admin@test.invalid', isAdmin: true }] });
    if (path === '/v1/catalog/task-profiles') return json({ items: [{ name: 'cli-large', cpu: '2', memory: '4Gi', storage: '2Gi', description: '' }] });
    if (path === '/v1/admin/runtime-images') return json(RUNTIME_IMAGES);
    if (path === '/v1/admin/runtime-images/credentials') return json(PUSH_CREDENTIAL, 201);
    if (path === '/v1/admin/compute-profiles') return method === 'POST' ? create(body) : json({ items: state.profiles });
    const match = path.match(/^\/v1\/admin\/compute-profiles\/([^/]+)\/?(.*)$/);
    if (!match) return json({ items: [] });
    const profile = state.profiles.find((p) => p.name === decodeURIComponent(match[1]!));
    return profile ? profileRoute(method, match[2]!, query, body, profile) : json({ error: 'not_found', message: '档位不存在', details: {} }, 404);
  };
  const previous = globalThis.fetch;
  globalThis.fetch = (async (raw: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(raw), 'http://localhost'), method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (method !== 'GET') writes.push({ method, path: url.pathname, query: url.search, body });
    return route(method, url.pathname, url.search, body);
  }) as typeof fetch;
  return { state, writes, restore: () => { globalThis.fetch = previous; } };
}
