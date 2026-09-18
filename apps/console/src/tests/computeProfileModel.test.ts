import { describe, expect, test } from 'bun:test';
import { ComputeProfileContentSchema, CreateComputeProfileRequestSchema, SaveComputeProfileRequestSchema, launchApplicabilityIssues } from '@crewstation/contracts';
import type { AgentProtocol } from '@crewstation/contracts';
import { parseComputeSearch } from '../features/admin/model/computeSearch';
import { applyPreset, blankDraft, draftDirty, draftFromDetail, splitErrorCode, toContent, toCreateRequest, toSaveRequest, validateProfileDraft, withProtocol } from '../features/admin/model/profileDraft';
import { presetsFor } from '../features/admin/model/profilePresets';
import { availabilityTone, shortDigest, testRunning, testTone } from '../features/admin/model/profileStatus';
import type { ProtocolField } from '../features/admin/model/protocolFields';
import { PROTOCOLS, configFileKindFor, showsField, suggestedBinaryPath } from '../features/admin/model/protocolFields';
import { previewPath } from '../features/admin/model/stepDraft';
import { profileDetail, terminalProfile } from './computeProfileFixture';

const FIELDS: readonly ProtocolField[] = ['extraArgs', 'configDir', 'isSandbox', 'model', 'opencode', 'configFile', 'terminalTest'];

/** 一个把所有协议字段都填上的草稿：用来证明不适用的字段不会被发送。 */
function everythingFilled(protocol: AgentProtocol) {
  return {
    ...blankDraft(protocol), name: 'full-profile', image: 'registry.cs.local/runtimes/x:1', binaryPath: '/opt/x/bin/x', extraArgs: '--fast\n\n--json', configDirEnv: 'X_CONFIG_DIR', configDirName: '.x', isSandbox: true,
    model: 'anthropic/claude-sonnet-5', opencode: { variant: 'high', temperature: '0.5', steps: '10', maxSteps: '20' }, testCommand: '/opt/x/bin/x\n--version', testExpect: '^x \\d+', testTimeoutSeconds: '30',
  };
}

describe('协议字段矩阵（RFC-006 §5.1）', () => {
  test('每种协议只显示适用的字段组，与 contracts 的 launchApplicabilityIssues 同一张表', () => {
    const shown = Object.fromEntries(PROTOCOLS.map((protocol) => [protocol, FIELDS.filter((field) => showsField(protocol, field))]));
    expect(shown).toEqual({
      'claude-code': ['extraArgs', 'configDir', 'isSandbox', 'model', 'configFile'],
      opencode: ['configDir', 'model', 'opencode', 'configFile'],
      terminal: ['extraArgs', 'terminalTest'],
    });
    expect(PROTOCOLS).toEqual(['claude-code', 'opencode', 'terminal']);
  });

  test('全填的草稿按协议组装后，服务端的适用性校验没有一条不适用字段', () => {
    for (const protocol of PROTOCOLS) {
      const content = toContent(everythingFilled(protocol));
      expect(launchApplicabilityIssues(ComputeProfileContentSchema.parse(content).launch)).toEqual([]);
      expect(content.terminalTest !== undefined).toBe(protocol === 'terminal');
    }
    const terminal = toContent(everythingFilled('terminal'));
    expect(terminal.launch).toEqual({ protocol: 'terminal', binaryPath: '/opt/x/bin/x', extraArgs: ['--fast', '--json'] });
    expect(terminal.terminalTest).toEqual({ command: ['/opt/x/bin/x', '--version'], expect: '^x \\d+', timeoutMs: 30_000 });
    expect(terminal.configFile).toEqual({ kind: 'none' });
    expect(toContent(everythingFilled('opencode')).launch).toEqual({ protocol: 'opencode', binaryPath: '/opt/x/bin/x', configDirEnv: 'X_CONFIG_DIR', configDirName: '.x', model: 'anthropic/claude-sonnet-5', opencode: { variant: 'high', temperature: 0.5, steps: 10, maxSteps: 20 } });
    expect(toContent(everythingFilled('claude-code')).launch).toEqual({ protocol: 'claude-code', binaryPath: '/opt/x/bin/x', extraArgs: ['--fast', '--json'], configDirEnv: 'X_CONFIG_DIR', configDirName: '.x', isSandbox: true, model: 'anthropic/claude-sonnet-5' });
  });

  test('二进制建议值与配置文件类型随协议走；通用终端没有默认路径也不绑定配置文件', () => {
    expect(PROTOCOLS.map(suggestedBinaryPath)).toEqual(['/usr/local/bin/claude', '/usr/local/bin/opencode', '']);
    expect(PROTOCOLS.map(configFileKindFor)).toEqual(['claude-settings', 'opencode-config', undefined]);
    expect(PROTOCOLS.map((protocol) => presetsFor(protocol))).toEqual([['claude-settings', 'blank'], ['opencode-config', 'blank'], ['blank']]);
  });

  test('新建时换协议：未改过的建议路径与预设跟着换，改过的保留；换到通用终端清掉配置文件绑定', () => {
    const claude = blankDraft('claude-code', 'claude-settings');
    expect(claude.configFileKind).toBe('claude-settings');
    expect(withProtocol(claude, 'opencode')).toMatchObject({ protocol: 'opencode', binaryPath: '/usr/local/bin/opencode', configFileKind: 'opencode-config', configFilePath: '{{agent.home}}/.opencode/opencode.json', secretNames: ['ANTHROPIC_API_KEY'] });
    expect(withProtocol(claude, 'terminal')).toMatchObject({ protocol: 'terminal', binaryPath: '', steps: [], secretNames: [], configFileKind: 'none', configFilePath: '' });
    const edited = { ...claude, binaryPath: '/opt/fork/claude', vars: [] };
    expect(withProtocol(edited, 'opencode')).toMatchObject({ binaryPath: '/opt/fork/claude', steps: claude.steps, secretNames: ['ANTHROPIC_AUTH_TOKEN'], configFileKind: 'opencode-config', configFilePath: claude.configFilePath });
    expect(withProtocol(blankDraft('opencode'), 'claude-code')).toMatchObject({ steps: [], configFileKind: 'none' });
    expect(applyPreset(claude, 'blank')).toMatchObject({ steps: [], vars: [], secretNames: [], configFileKind: 'none' });
  });
});

describe('草稿校验', () => {
  test('新建时 default 是保留名、名称须为 slug；编辑时名称不参与校验', () => {
    const draft = { ...blankDraft('claude-code'), image: 'registry.cs.local/runtimes/x:1' };
    expect(validateProfileDraft({ ...draft, name: 'default' }, true)).toEqual({ name: 'reservedName' });
    expect(validateProfileDraft({ ...draft, name: 'Bad Name' }, true)).toEqual({ name: 'profileName' });
    expect(validateProfileDraft({ ...draft, name: 'ok-name' }, true)).toEqual({});
    expect(validateProfileDraft({ ...draft, name: 'default' }, false)).toEqual({});
  });

  test('启动字段：镜像必填、二进制必须是绝对路径、平台保留参数与变量名被拒绝', () => {
    const draft = { ...blankDraft('claude-code'), name: 'ok-name', binaryPath: 'claude', extraArgs: '--fork-flag\n--model=opus', configDirEnv: 'CS_AGENT_HOME', configDirName: '../x' };
    expect(validateProfileDraft(draft, true)).toEqual({ image: 'imageRequired', binaryPath: 'binaryPath', extraArgs: 'reservedArg|--model', configDirEnv: 'reservedEnv', configDirName: 'configDirName' });
    expect(splitErrorCode('reservedArg|--model')).toEqual({ key: 'reservedArg', value: '--model' });
    expect(splitErrorCode('imageRequired')).toEqual({ key: 'imageRequired' });
    const opencode = { ...blankDraft('opencode'), name: 'ok-name', image: 'x', extraArgs: '--model', configDirEnv: '1BAD', opencode: { variant: '', temperature: '3', steps: '0', maxSteps: '1.5' } };
    // extraArgs 对 opencode 不适用：不显示也不校验，保存时不发送。
    expect(validateProfileDraft(opencode, true)).toEqual({ configDirEnv: 'envName', 'opencode.temperature': 'temperature', 'opencode.steps': 'positiveInt', 'opencode.maxSteps': 'positiveInt' });
  });

  test('通用终端：测试命令、期望正则与超时都必填且合法', () => {
    const draft = { ...blankDraft('terminal'), name: 'shell-cli', image: 'x', binaryPath: '/opt/x', testTimeoutSeconds: '0' };
    expect(validateProfileDraft(draft, true)).toEqual({ testCommand: 'testCommandRequired', testExpect: 'testExpectRequired', testTimeoutSeconds: 'testTimeout' });
    expect(validateProfileDraft({ ...draft, testCommand: '/opt/x\n--version', testExpect: '(', testTimeoutSeconds: '30' }, true)).toEqual({ testExpect: 'regex' });
    expect(validateProfileDraft({ ...draft, testCommand: '/opt/x', testExpect: '^x', testTimeoutSeconds: '601' }, true)).toEqual({ testTimeoutSeconds: 'testTimeout' });
  });

  test('变量、凭据与配置文件路径', () => {
    const draft = { ...blankDraft('claude-code', 'claude-settings'), name: 'ok-name', image: 'x', vars: [{ name: 'A', value: '1' }, { name: 'A', value: '2' }, { name: 'ANTHROPIC_AUTH_TOKEN', value: 'dup' }], configFilePath: ' ' };
    expect(validateProfileDraft(draft, true)).toEqual({ 'vars.1.name': 'envNameDuplicate', 'vars.2.name': 'envNameDuplicate', configFilePath: 'pathRequired' });
  });
});

describe('与契约往返', () => {
  test('详情 → 草稿 → 内容：未改动时逐字段等于服务端内容，且草稿不算脏', () => {
    for (const detail of [profileDetail(), terminalProfile(), profileDetail({ name: 'opencode-lite', protocol: 'opencode', content: { launch: { protocol: 'opencode', binaryPath: '/usr/local/bin/opencode', extraArgs: [], isSandbox: false, opencode: { temperature: 0.2 } }, configFile: { kind: 'none' }, steps: [], secretNames: [] } })]) {
      const draft = draftFromDetail(detail);
      expect(ComputeProfileContentSchema.parse(toContent(draft))).toEqual(detail.content);
      expect(draftDirty(draft, draftFromDetail(detail))).toBe(false);
    }
  });

  test('保存体带 expectedRevision；凭据只发有意义的操作：保留已声明的、清除任意名、丢掉空替换与未声明的替换', () => {
    const draft = { ...draftFromDetail(profileDetail()), credentials: { ANTHROPIC_AUTH_TOKEN: { op: 'keep' as const }, OLD_TOKEN: { op: 'clear' as const }, STRAY: { op: 'replace' as const, value: 'x' } } };
    const request = SaveComputeProfileRequestSchema.parse(toSaveRequest(draft, 7));
    expect(request.expectedRevision).toBe(7);
    expect(request.credentials).toEqual({ ANTHROPIC_AUTH_TOKEN: { op: 'keep' }, OLD_TOKEN: { op: 'clear' } });
    const fresh = { ...blankDraft('claude-code', 'claude-settings'), name: 'new-one', image: 'registry.cs.local/runtimes/claude:2.1' };
    expect(fresh.credentials).toEqual({ ANTHROPIC_AUTH_TOKEN: { op: 'replace', value: '' } });
    const create = CreateComputeProfileRequestSchema.parse(toCreateRequest(fresh));
    expect(create.credentials).toEqual({});
    expect(CreateComputeProfileRequestSchema.parse(toCreateRequest({ ...fresh, credentials: { ANTHROPIC_AUTH_TOKEN: { op: 'replace', value: 'sk-1' } } })).credentials).toEqual({ ANTHROPIC_AUTH_TOKEN: { op: 'replace', value: 'sk-1' } });
  });

  test('路径预览：工作卷上的路径与同会话其他 Agent 共享，其余路径属于该 Agent 自己的 Pod', () => {
    expect(previewPath('~/.claude/settings.json')).toMatchObject({ scope: 'private' });
    expect(previewPath('{{workspace}}/.env')).toMatchObject({ scope: 'workspace', path: '/work/.env' });
    expect(previewPath('/etc/app/config.json')).toMatchObject({ scope: 'private' });
    expect(previewPath('relative/path')).toMatchObject({ scope: 'invalid' });
  });
});

describe('列表状态与查询串', () => {
  test('状态色、测试进行中判定与摘要短码', () => {
    expect((['ready', 'testing', 'test-failed', 'disabled', 'untested'] as const).map(availabilityTone)).toEqual(['success', 'info', 'danger', 'warning', 'neutral']);
    expect((['passed', 'failed', 'unknown', 'superseded', 'queued', 'running'] as const).map(testTone)).toEqual(['success', 'danger', 'warning', 'neutral', 'info', 'info']);
    expect([testRunning({ state: 'queued' }), testRunning({ state: 'running' }), testRunning({ state: 'passed' }), testRunning(undefined)]).toEqual([true, true, false, false]);
    expect(shortDigest(`sha256:${'0123456789ab'.repeat(5)}cdef`)).toBe('0123456789ab');
  });

  test('/admin/compute 只认 profile 与 create；旧的 tab／config 参数被忽略', () => {
    expect(parseComputeSearch({ profile: 'claude-daily' })).toEqual({ profile: 'claude-daily' });
    expect(parseComputeSearch({ create: 'true' })).toEqual({ create: true });
    expect(parseComputeSearch({ tab: 'runtime', config: 'arc_1' })).toEqual({});
    expect(parseComputeSearch({ profile: 'Not A Slug', create: true })).toEqual({ create: true });
  });
});
