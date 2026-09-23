import { describe, expect, test } from 'bun:test';
import type { BeforeStartStep, ComputeProfileContent, LaunchSpec } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { LaunchSpecSchema } from '@crewstation/contracts';
import { availabilityOf, contentHashOf, credentialStampOf } from '../domain/computeProfile';
import { planCredentialWrites } from '../domain/credentialWrites';
import type { RegistryLayout } from '../domain/imageReference';
import { parseProfileImage, pinnedReference, pullReference, repositoryOf } from '../domain/imageReference';
import type { ProfileTest } from '../domain/profileTest';
import { completeContainerStages, initialStages, mergeStages, outcomeSentence, skipUnreachedStages, testPrompt } from '../domain/profileTest';
import { validateProfileContent } from '../domain/profileValidation';
import { assertJsonTemplate, placeholdersInsideStrings, stripJsonComments, validateRevisionContent } from '../domain/revisionValidation';

const credentialIds = new Map<string, string>();
const credential = (name: string) => { if (!credentialIds.has(name)) credentialIds.set(name, newResourceId()); return { id: credentialIds.get(name)!, name }; };
const credentialList = (...names: string[]) => names.map(credential);
const file = (patch: Partial<Extract<BeforeStartStep, { kind: 'file' }>> = {}): BeforeStartStep => ({ kind: 'file', stepId: 'f', name: 'f', pathTemplate: '{{agent.home}}/.claude/settings.json', contentTemplate: '{"env":{"K":"{{vars.K}}"}}', format: 'json', mode: 0o600, existing: 'require-same', ...patch });
const script = (patch: Partial<Extract<BeforeStartStep, { kind: 'script' }>> = {}): BeforeStartStep => ({ kind: 'script', stepId: 's', name: 's', language: 'shell', source: 'true', argv: [], timeoutMs: 1000, ...patch });
const launch = (patch: Partial<LaunchSpec> = {}): LaunchSpec => LaunchSpecSchema.parse({ protocol: 'claude-code', binaryPath: '/usr/local/bin/claude', ...patch });
const content = (patch: Partial<ComputeProfileContent> = {}): ComputeProfileContent => ({ image: 'runtime/cli:1', launch: launch(), steps: [file()], vars: { K: 'v' }, secrets: credentialList('TOKEN'), configFile: { kind: 'none' }, ...patch });
const messageOf = (fn: () => void) => { try { fn(); return undefined; } catch (e) { return e as { message: string; details: Record<string, unknown> }; } };
const layout: RegistryLayout = { pullBase: 'registry.cs.svc:5000', pushHost: 'registry.cs.localhost', baseRepository: 'crewstation/task-runtime', runtimePrefix: 'runtime/' };

describe('启动前内容的保存校验（沿用 RFC-004）', () => {
  test('未声明变量、保留名、env 只能引用之前脚本、路径形态与 JSON 结构逐项定位到步骤与字段', () => {
    expect(messageOf(() => validateRevisionContent(content({ steps: [file({ contentTemplate: '{"x":"{{vars.NOPE}}"}' })] })))).toMatchObject({ details: { stepId: 'f', field: 'contentTemplate' } });
    expect(messageOf(() => validateRevisionContent(content({ steps: [file({ contentTemplate: '{"x":"{{env.FROM}}"}' })] })))?.message).toContain('之前脚本步骤');
    expect(() => validateRevisionContent(content({ steps: [script({ stepId: 'a' }), file({ contentTemplate: '{"x":"{{env.FROM}}"}' })] }))).not.toThrow();
    expect(messageOf(() => validateRevisionContent(content({ vars: { HOME: '/x' } })))).toMatchObject({ details: { field: 'vars.HOME' } });
    expect(messageOf(() => validateRevisionContent(content({ vars: { CS_MCP_TOKEN: 'x' } })))).toMatchObject({ details: { field: 'vars.CS_MCP_TOKEN' } });
    expect(messageOf(() => validateRevisionContent(content({ secrets: credentialList('K') })))?.message).toContain('同时出现');
    expect(messageOf(() => validateRevisionContent(content({ steps: [file({ pathTemplate: 'relative/path.json' })] })))).toMatchObject({ details: { stepId: 'f', field: 'pathTemplate' } });
    expect(messageOf(() => validateRevisionContent(content({ steps: [file({ pathTemplate: '/etc/../x' })] })))?.message).toContain('..');
    expect(() => validateRevisionContent(content({ steps: [file({ pathTemplate: '~/.claude/settings.json' })] }))).not.toThrow();
    expect(messageOf(() => validateRevisionContent(content({ steps: [file({ contentTemplate: '{"x": {{vars.K}} }' })] })))?.message).toContain('字符串值');
    expect(messageOf(() => validateRevisionContent(content({ steps: [file({ contentTemplate: '{bad' })] })))?.message).toContain('不是合法文档');
    expect(() => validateRevisionContent(content({ steps: [file({ format: 'jsonc', contentTemplate: '{ // note\n "x": "{{secrets.TOKEN}}" }' })] }))).not.toThrow();
    expect(messageOf(() => validateRevisionContent(content({ steps: [script({ language: 'custom', interpreter: ['tool'] })] })))?.message).toContain('绝对路径');
    expect(messageOf(() => validateRevisionContent(content({ configFile: { kind: 'claude-settings', pathTemplate: '{{agent.home}}/other.json' } })))?.message).toContain('没有对应的文件步骤');
  });
  test('RFC-006：mcp.* 可写进内容，但不能当路径开头', () => {
    expect(() => validateRevisionContent(content({ steps: [file({ contentTemplate: '{"url":"{{mcp.capabilitiesUrl}}","token":"{{mcp.token}}"}' })] }))).not.toThrow();
    expect(messageOf(() => validateRevisionContent(content({ steps: [file({ pathTemplate: '{{mcp.token}}/x.json' })] })))).toMatchObject({ details: { field: 'pathTemplate' } });
  });
  test('JSONC 注释剥离与占位位置检查', () => {
    expect(stripJsonComments('{"a": "http://x//y", /* c */ "b": 1 // tail\n}').replace(/\s/g, '')).toBe('{"a":"http://x//y","b":1}');
    expect(placeholdersInsideStrings('{"a":"{{vars.X}}"}')).toBe(true);
    expect(placeholdersInsideStrings('{"a":{{vars.X}}}')).toBe(false);
    expect(() => assertJsonTemplate('{"a":"{{vars.X}}"}', 'json', 's')).not.toThrow();
  });
  test('凭据写操作：keep 只对已有值；clear 未设置无副作用；未声明的名字被拒', () => {
    const plan = planCredentialWrites(new Set([credential('A').id]), credentialList('A', 'B', 'C'), { [credential('A').id]: { op: 'keep' }, [credential('B').id]: { op: 'replace', value: 'x' }, [credential('C').id]: { op: 'clear' } });
    expect(plan).toEqual({ replace: [{ id: credential('B').id, value: 'x' }], clear: [] });
    expect(() => planCredentialWrites(new Set(), credentialList('A'), { [credential('A').id]: { op: 'keep' } })).toThrow('尚未设置');
    expect(() => planCredentialWrites(new Set(), credentialList('A'), { [credential('Z').id]: { op: 'replace', value: 'x' } })).toThrow('未在 secrets');
    expect(planCredentialWrites(new Set([credential('OLD').id]), credentialList('A'), { [credential('OLD').id]: { op: 'clear' } })).toEqual({ replace: [], clear: [credential('OLD').id] });
  });
});

describe('档位内容按协议校验（RFC-006 §5.1）', () => {
  test('launch.protocol 必须等于档位协议（P1）', () => {
    expect(messageOf(() => validateProfileContent('opencode', content()))).toMatchObject({ details: { field: 'content.launch.protocol' } });
  });
  test('附加参数不能覆盖平台装配的 claude 参数，含 --flag=value；通用终端不设保留表', () => {
    expect(messageOf(() => validateProfileContent('claude-code', content({ launch: launch({ extraArgs: ['--model=x'] }) })))).toMatchObject({ details: { field: 'content.launch.extraArgs' } });
    expect(messageOf(() => validateProfileContent('claude-code', content({ launch: launch({ extraArgs: ['--settings'] }) })))?.message).toContain('--settings');
    expect(() => validateProfileContent('claude-code', content({ launch: launch({ extraArgs: ['--skip-safe-check'] }) }))).not.toThrow();
    const terminal = content({ launch: launch({ protocol: 'terminal', binaryPath: '/opt/x/bin/x', extraArgs: ['--model', 'y'] }), terminalTest: { command: ['/opt/x/bin/x', '--version'], expect: '^x', timeoutMs: 60_000 }, configFile: { kind: 'none' } });
    expect(() => validateProfileContent('terminal', terminal)).not.toThrow();
  });
  test('配置目录变量名不能撞上平台写入的变量或 CS_ 前缀', () => {
    for (const env of ['PWD', 'OPENCODE_CONFIG_CONTENT', 'IS_SANDBOX', 'CS_AGENT_ID', 'HOME']) {
      expect(messageOf(() => validateProfileContent('claude-code', content({ launch: launch({ configDirEnv: env }) })))).toMatchObject({ details: { field: 'content.launch.configDirEnv' } });
    }
    expect(() => validateProfileContent('claude-code', content({ launch: launch({ configDirEnv: 'FORK_CONFIG_DIR', configDirName: '.fork' }) }))).not.toThrow();
  });
  test('通用终端必须有测试命令且正则合法；已知协议不能带测试命令；配置绑定只配对应协议', () => {
    const base = { launch: launch({ protocol: 'terminal', binaryPath: '/opt/x/bin/x' }), configFile: { kind: 'none' as const } };
    expect(messageOf(() => validateProfileContent('terminal', content(base)))).toMatchObject({ details: { field: 'content.terminalTest' } });
    expect(messageOf(() => validateProfileContent('terminal', content({ ...base, terminalTest: { command: ['/opt/x/bin/x'], expect: '(', timeoutMs: 1000 } })))).toMatchObject({ details: { field: 'content.terminalTest.expect' } });
    expect(messageOf(() => validateProfileContent('claude-code', content({ terminalTest: { command: ['x'], expect: 'x', timeoutMs: 1000 } })))).toMatchObject({ details: { field: 'content.terminalTest' } });
    expect(messageOf(() => validateProfileContent('opencode', content({ launch: launch({ protocol: 'opencode', binaryPath: '/usr/local/bin/opencode' }), configFile: { kind: 'claude-settings', pathTemplate: '{{agent.home}}/.claude/settings.json' } })))?.message).toContain('claude-code');
  });
  test('LaunchSpec 拒绝不适用的字段：opencode 带附加参数、非 claude 带 IS_SANDBOX、终端带模型、相对二进制路径', () => {
    expect(LaunchSpecSchema.safeParse({ protocol: 'opencode', binaryPath: '/x', extraArgs: ['--a'] }).success).toBe(false);
    expect(LaunchSpecSchema.safeParse({ protocol: 'opencode', binaryPath: '/x', isSandbox: true }).success).toBe(false);
    expect(LaunchSpecSchema.safeParse({ protocol: 'terminal', binaryPath: '/x', model: 'm' }).success).toBe(false);
    expect(LaunchSpecSchema.safeParse({ protocol: 'claude-code', binaryPath: 'claude' }).success).toBe(false);
    expect(LaunchSpecSchema.safeParse({ protocol: 'opencode', binaryPath: '/x', opencode: { temperature: 0.2, maxSteps: 50 } }).success).toBe(true);
  });
});

describe('镜像只来自平台仓库（C15）', () => {
  test('三种写法规范化为集群内拉取地址；别的仓库、runtime/ 之外的路径与缺标签被拒', () => {
    for (const input of ['runtime/glm:1.2', 'registry.cs.localhost/runtime/glm:1.2', 'registry.cs.svc:5000/runtime/glm:1.2']) {
      const parsed = parseProfileImage(input, layout);
      expect(parsed).toMatchObject({ ok: true, image: { repository: 'runtime/glm', tag: '1.2' } });
      if (parsed.ok) expect(pullReference(parsed.image, layout)).toBe('registry.cs.svc:5000/runtime/glm:1.2');
    }
    expect(parseProfileImage('crewstation/task-runtime:dev', layout)).toMatchObject({ ok: true });
    expect(parseProfileImage('docker.io/library/ubuntu:24.04', layout)).toMatchObject({ ok: false });
    expect(parseProfileImage('ghcr.io/x/y:1', layout)).toMatchObject({ ok: false });
    expect(parseProfileImage('library/ubuntu:24.04', layout)).toMatchObject({ ok: false });
    expect(parseProfileImage('runtime/glm', layout)).toMatchObject({ ok: false });
    expect(parseProfileImage('runtime/glm@sha256:abc', layout)).toMatchObject({ ok: false });
    const digest = `sha256:${'a'.repeat(64)}`;
    expect(parseProfileImage(`runtime/glm@${digest}`, layout)).toMatchObject({ ok: true, image: { repository: 'runtime/glm', digest } });
    expect(pinnedReference(repositoryOf('registry.cs.svc:5000/runtime/glm:1.2', layout), digest, layout)).toBe(`registry.cs.svc:5000/runtime/glm@${digest}`);
  });
});

describe('修订哈希、可用性与测试阶段', () => {
  test('哈希对键顺序不敏感、对步骤顺序、镜像摘要与凭据戳敏感', () => {
    const a = content({ steps: [script({ stepId: 'a' }), script({ stepId: 'b' })], vars: { A: '1', B: '2' } });
    const b = content({ steps: [script({ stepId: 'a' }), script({ stepId: 'b' })], vars: { B: '2', A: '1' } });
    const c = content({ steps: [script({ stepId: 'b' }), script({ stepId: 'a' })], vars: { A: '1', B: '2' } });
    const stamp = credentialStampOf(credentialList('TOKEN'), [{ id: credential('TOKEN').id, cipherText: 'c1' }]);
    expect(contentHashOf(a, 'sha256:1', stamp)).toBe(contentHashOf(b, 'sha256:1', stamp));
    expect(contentHashOf(a, 'sha256:1', stamp)).not.toBe(contentHashOf(c, 'sha256:1', stamp));
    expect(contentHashOf(a, 'sha256:1', stamp)).not.toBe(contentHashOf(a, 'sha256:2', stamp));
    expect(stamp).not.toBe(credentialStampOf(credentialList('TOKEN'), [{ id: credential('TOKEN').id, cipherText: 'c2' }]));
    expect(credentialStampOf(credentialList('TOKEN'), [{ id: credential('OTHER').id, cipherText: 'x' }])).toBe(credentialStampOf(credentialList('TOKEN'), []));
  });
  test('可用性：停用优先；测试须对得上当前内容哈希；四种不可用都给出原因', () => {
    const test = (patch: Partial<ProfileTest>): ProfileTest => ({ testId: '01a0bf5d-8f4b-729c-88d5-a70a648c5dcc' as never, profile: 'p', revision: 2, contentHash: 'h', trigger: 'save', createdBy: '01a0bf5d-8f4b-7187-83ae-25aa3b5714fc' as never, state: 'passed', context: { kind: 'platform-namespace' }, stages: [], createdAt: new Date(), ...patch });
    expect(availabilityOf({ name: 'p', enabled: true }, { contentHash: 'h' }, test({}))).toEqual({ state: 'ready', available: true });
    expect(availabilityOf({ name: 'p', enabled: false }, { contentHash: 'h' }, test({}))).toMatchObject({ state: 'disabled', available: false });
    expect(availabilityOf({ name: 'p', enabled: true }, { contentHash: 'h' }, undefined)).toMatchObject({ state: 'untested', available: false });
    expect(availabilityOf({ name: 'p', enabled: true }, { contentHash: 'h2' }, test({}))).toMatchObject({ state: 'untested' });
    expect(availabilityOf({ name: 'p', enabled: true }, { contentHash: 'h' }, test({ state: 'running' }))).toMatchObject({ state: 'testing', available: false });
    const failed = availabilityOf({ name: 'p', enabled: true }, { contentHash: 'h' }, test({ state: 'failed', outcome: 'network-blocked' }));
    expect(failed).toMatchObject({ state: 'test-failed', available: false });
    expect(failed.reason).toContain(outcomeSentence('network-blocked'));
  });
  test('阶段表按协议排好；合并按 id 覆盖；每次测试一个新 nonce', () => {
    // RFC-022 D8：前三段与公共启动进度同名同序，「启动 CLI」改为「Agent 启动中」。
    expect(initialStages('claude-code', [{ stepId: 'a', name: 'A' }]).map((s) => s.id)).toEqual(['queue', 'container', 'connect', 'step:a', 'agent', 'model']);
    expect(initialStages('terminal', []).map((s) => [s.id, s.kind, s.name])).toEqual([['queue', 'queue', '排队分配容器'], ['container', 'container', '容器启动中（调度、拉取镜像）'], ['connect', 'connect', '容器已启动，等待连接'], ['command', 'command', '测试命令']]);
    const merged = mergeStages(initialStages('terminal', []), [{ id: 'command', kind: 'command', name: '测试命令', state: 'failed' }, { id: 'extra', kind: 'launch', name: 'x', state: 'succeeded' }]);
    expect(merged.map((s) => [s.id, s.state])).toEqual([['queue', 'pending'], ['container', 'pending'], ['connect', 'pending'], ['command', 'failed'], ['extra', 'succeeded']]);
    // 失败收尾时没走到的阶段记为跳过；已有终态的阶段不动。
    expect(skipUnreachedStages(merged).map((s) => [s.id, s.state])).toEqual([['queue', 'skipped'], ['container', 'skipped'], ['connect', 'skipped'], ['command', 'failed'], ['extra', 'succeeded']]);
    // 测试通过：没收到回报的容器段（含之前记录里的 image／runner）按已完成记，别的段不动。
    const passed = completeContainerStages([...merged, { id: 'image', kind: 'image', name: '拉取镜像', state: 'pending' }, { id: 'model', kind: 'model', name: '真实模型轮次', state: 'pending' }]);
    expect(passed.map((s) => [s.id, s.state])).toEqual([['queue', 'succeeded'], ['container', 'succeeded'], ['connect', 'succeeded'], ['command', 'failed'], ['extra', 'succeeded'], ['image', 'succeeded'], ['model', 'pending']]);
    const [one, two] = [testPrompt(), testPrompt()];
    expect(one.prompt).toContain(one.expectedReply);
    expect(one.expectedReply).not.toBe(two.expectedReply);
  });
});
