import type { AgentProtocol, ComputeProfileContentInput, ComputeProfileDetailDto, CreateComputeProfileInput, ProfileCredentialState, SaveComputeProfileInput } from '@crewstation/contracts';
import { ConfigDirNameSchema, DEFAULT_COMPUTE_PROFILE, EnvNameSchema, SlugSchema, isPlatformSpawnEnv, reservedLaunchArg } from '@crewstation/contracts';
import type { ProfilePreset } from './profilePresets';
import { presetContent, presetsFor } from './profilePresets';
import { configFileKindFor, showsField, suggestedBinaryPath } from './protocolFields';
import type { CredentialOp, DraftErrors, StepDraft } from './stepDraft';
import { lines, stepFromDto, stepToDto, validateSteps } from './stepDraft';

/**
 * 档位编辑器的草稿（RFC-006）：一份完整执行配置。数字与列表一律用字符串承载，保存时按协议只取适用的字段，
 * 不适用的字段不发送（服务端会拒绝不适用的字段，见 contracts 的 launchApplicabilityIssues）。
 */
export interface ProfileDraft {
  name: string;
  description: string;
  protocol: AgentProtocol;
  image: string;
  binaryPath: string;
  /** 每行一个参数。 */
  extraArgs: string;
  configDirEnv: string;
  configDirName: string;
  isSandbox: boolean;
  model: string;
  opencode: { variant: string; temperature: string; steps: string; maxSteps: string };
  taskProfile: string;
  steps: StepDraft[];
  vars: Array<{ name: string; value: string }>;
  secretNames: string[];
  credentials: Record<string, CredentialOp>;
  configFileKind: 'none' | 'claude-settings' | 'opencode-config';
  configFilePath: string;
  /** 通用终端协议的测试命令，每行一个 argv 元素。 */
  testCommand: string;
  testExpect: string;
  testTimeoutSeconds: string;
}

const EMPTY_OPENCODE = { variant: '', temperature: '', steps: '', maxSteps: '' };

export function blankDraft(protocol: AgentProtocol, preset: ProfilePreset = 'blank'): ProfileDraft {
  return applyPreset({
    name: '', description: '', protocol, image: '', binaryPath: suggestedBinaryPath(protocol), extraArgs: '', configDirEnv: '', configDirName: '', isSandbox: false, model: '',
    opencode: { ...EMPTY_OPENCODE }, taskProfile: '', steps: [], vars: [], secretNames: [], credentials: {}, configFileKind: 'none', configFilePath: '',
    testCommand: '', testExpect: '', testTimeoutSeconds: '60',
  }, preset);
}

/** 预设只替换启动前步骤、变量、凭据与配置绑定；启动参数与名称保持。 */
export function applyPreset(draft: ProfileDraft, preset: ProfilePreset): ProfileDraft {
  const content = presetContent(preset);
  return { ...draft, steps: content.steps, vars: content.vars, secretNames: content.secretNames, credentials: content.credentials, configFileKind: content.configFileKind, configFilePath: content.configFilePath };
}

/** 草稿的启动前内容是否仍是某个预设的原样（管理员还没动过）。 */
function untouchedPreset(draft: ProfileDraft): ProfilePreset | undefined {
  const beforeStart = (c: Pick<ProfileDraft, 'steps' | 'vars' | 'secretNames' | 'credentials' | 'configFileKind' | 'configFilePath'>) => JSON.stringify([c.steps, c.vars, c.secretNames, c.credentials, c.configFileKind, c.configFilePath]);
  const current = beforeStart(draft);
  return presetsFor(draft.protocol).find((preset) => beforeStart(presetContent(preset)) === current);
}

/**
 * 新建时换协议：建议的二进制路径跟着换（管理员改过的路径保留），不适用的配置绑定清掉；
 * 启动前内容若还是旧协议专属预设的原样（如 Claude settings.json），换成新协议的对应预设，免得 OpenCode 档位带着 Claude 的配置文件。
 */
export function withProtocol(draft: ProfileDraft, protocol: AgentProtocol): ProfileDraft {
  const pristinePath = draft.binaryPath === '' || draft.binaryPath === suggestedBinaryPath(draft.protocol);
  const kind = configFileKindFor(protocol), preset = untouchedPreset(draft);
  const next: ProfileDraft = {
    ...draft, protocol, binaryPath: pristinePath ? suggestedBinaryPath(protocol) : draft.binaryPath,
    configFileKind: kind && draft.configFileKind !== 'none' ? kind : 'none', configFilePath: kind && draft.configFileKind !== 'none' ? draft.configFilePath : '',
  };
  return preset !== undefined && preset !== 'blank' ? applyPreset(next, presetsFor(protocol)[0]!) : next;
}

const numberText = (value: number | undefined) => (value === undefined ? '' : String(value));

/** 已设置的凭据默认保留；声明了但还没有值的凭据默认待填写。 */
function credentialOps(secretNames: readonly string[], states: readonly ProfileCredentialState[]): Record<string, CredentialOp> {
  return Object.fromEntries(secretNames.map((name) => [name, states.find((s) => s.name === name)?.set ? { op: 'keep' as const } : { op: 'replace' as const, value: '' }]));
}

export function draftFromDetail(detail: ComputeProfileDetailDto): ProfileDraft {
  const { content } = detail, launch = content.launch, test = content.terminalTest;
  return {
    name: detail.name, description: detail.description, protocol: detail.protocol, image: content.image, binaryPath: launch.binaryPath,
    extraArgs: launch.extraArgs.join('\n'), configDirEnv: launch.configDirEnv ?? '', configDirName: launch.configDirName ?? '', isSandbox: launch.isSandbox, model: launch.model ?? '',
    opencode: { variant: launch.opencode?.variant ?? '', temperature: numberText(launch.opencode?.temperature), steps: numberText(launch.opencode?.steps), maxSteps: numberText(launch.opencode?.maxSteps) },
    taskProfile: content.taskProfile ?? '', steps: content.steps.map(stepFromDto), vars: Object.entries(content.vars).map(([name, value]) => ({ name, value })),
    secretNames: [...content.secretNames], credentials: credentialOps(content.secretNames, detail.credentials),
    configFileKind: content.configFile.kind, configFilePath: content.configFile.kind === 'none' ? '' : content.configFile.pathTemplate,
    testCommand: test?.command.join('\n') ?? '', testExpect: test?.expect ?? '', testTimeoutSeconds: String(Math.round((test?.timeoutMs ?? 60_000) / 1000)),
  };
}

/** 错误码可以带一个值（`reservedArg|--model`）；界面据此在文案里点名是哪一项。 */
export function splitErrorCode(code: string): { key: string; value?: string } {
  const at = code.indexOf('|');
  return at < 0 ? { key: code } : { key: code.slice(0, at), value: code.slice(at + 1) };
}

function validateLaunch(draft: ProfileDraft, errors: DraftErrors): void {
  const p = draft.protocol;
  if (!draft.image.trim()) errors.image = 'imageRequired';
  if (!draft.binaryPath.trim().startsWith('/')) errors.binaryPath = 'binaryPath';
  if (showsField(p, 'extraArgs')) {
    const reserved = lines(draft.extraArgs).map((arg) => reservedLaunchArg(p, arg)).find((flag) => flag !== undefined);
    if (reserved) errors.extraArgs = `reservedArg|${reserved}`;
  }
  if (showsField(p, 'configDir')) {
    const env = draft.configDirEnv.trim(), leaf = draft.configDirName.trim();
    if (env && !EnvNameSchema.safeParse(env).success) errors.configDirEnv = 'envName';
    else if (env && isPlatformSpawnEnv(env)) errors.configDirEnv = 'reservedEnv';
    if (leaf && !ConfigDirNameSchema.safeParse(leaf).success) errors.configDirName = 'configDirName';
  }
  if (showsField(p, 'opencode')) {
    const temperature = draft.opencode.temperature.trim();
    if (temperature && !(Number(temperature) >= 0 && Number(temperature) <= 2)) errors['opencode.temperature'] = 'temperature';
    for (const key of ['steps', 'maxSteps'] as const) {
      const value = draft.opencode[key].trim();
      if (value && !(Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 10000)) errors[`opencode.${key}`] = 'positiveInt';
    }
  }
}

function validateTerminalTest(draft: ProfileDraft, errors: DraftErrors): void {
  if (!showsField(draft.protocol, 'terminalTest')) return;
  if (lines(draft.testCommand).length === 0) errors.testCommand = 'testCommandRequired';
  if (!draft.testExpect.trim()) errors.testExpect = 'testExpectRequired';
  else { try { new RegExp(draft.testExpect); } catch { errors.testExpect = 'regex'; } }
  const seconds = Number(draft.testTimeoutSeconds);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) errors.testTimeoutSeconds = 'testTimeout';
}

/** 客户端只拦能即时定位的错误；模板变量、镜像能否解析与凭据是否齐全由服务端与测试作业回报。 */
export function validateProfileDraft(draft: ProfileDraft, creating: boolean): DraftErrors {
  const errors: DraftErrors = {};
  if (creating && draft.name === DEFAULT_COMPUTE_PROFILE) errors.name = 'reservedName';
  else if (creating && !SlugSchema.safeParse(draft.name).success) errors.name = 'profileName';
  if (draft.description.length > 500) errors.description = 'descriptionTooLong';
  validateLaunch(draft, errors);
  validateTerminalTest(draft, errors);
  validateSteps(draft.steps, errors);
  const varNames = new Set<string>();
  draft.vars.forEach((v, i) => {
    if (!EnvNameSchema.safeParse(v.name).success) errors[`vars.${i}.name`] = 'envName';
    else if (varNames.has(v.name) || draft.secretNames.includes(v.name)) errors[`vars.${i}.name`] = 'envNameDuplicate';
    varNames.add(v.name);
  });
  draft.secretNames.forEach((name, i) => { if (!EnvNameSchema.safeParse(name).success) errors[`secrets.${i}`] = 'envName'; });
  if (draft.configFileKind !== 'none' && !draft.configFilePath.trim()) errors.configFilePath = 'pathRequired';
  return errors;
}

function opencodeParams(draft: ProfileDraft) {
  const o = draft.opencode, n = (text: string) => (text.trim() === '' ? undefined : Number(text));
  const params = { ...(o.variant.trim() ? { variant: o.variant.trim() } : {}), ...(n(o.temperature) === undefined ? {} : { temperature: n(o.temperature)! }), ...(n(o.steps) === undefined ? {} : { steps: n(o.steps)! }), ...(n(o.maxSteps) === undefined ? {} : { maxSteps: n(o.maxSteps)! }) };
  return Object.keys(params).length > 0 ? params : undefined;
}

/** 按协议只组装适用的字段；空的可选项不发送。 */
export function toContent(draft: ProfileDraft): ComputeProfileContentInput {
  const p = draft.protocol, trimmed = (text: string) => text.trim(), opencode = showsField(p, 'opencode') ? opencodeParams(draft) : undefined;
  const kind = configFileKindFor(p);
  return {
    image: trimmed(draft.image),
    launch: {
      protocol: p, binaryPath: trimmed(draft.binaryPath),
      ...(showsField(p, 'extraArgs') ? { extraArgs: lines(draft.extraArgs) } : {}),
      ...(showsField(p, 'configDir') && trimmed(draft.configDirEnv) ? { configDirEnv: trimmed(draft.configDirEnv) } : {}),
      ...(showsField(p, 'configDir') && trimmed(draft.configDirName) ? { configDirName: trimmed(draft.configDirName) } : {}),
      ...(showsField(p, 'isSandbox') ? { isSandbox: draft.isSandbox } : {}),
      ...(showsField(p, 'model') && trimmed(draft.model) ? { model: trimmed(draft.model) } : {}),
      ...(opencode ? { opencode } : {}),
    },
    ...(trimmed(draft.taskProfile) ? { taskProfile: trimmed(draft.taskProfile) } : {}),
    steps: draft.steps.map(stepToDto),
    vars: Object.fromEntries(draft.vars.map((v) => [v.name, v.value])),
    secretNames: draft.secretNames,
    configFile: kind && draft.configFileKind !== 'none' ? { kind, pathTemplate: trimmed(draft.configFilePath) } : { kind: 'none' },
    ...(showsField(p, 'terminalTest') ? { terminalTest: { command: lines(draft.testCommand), expect: draft.testExpect, timeoutMs: Number(draft.testTimeoutSeconds) * 1000 } } : {}),
  };
}

/** keep／replace 只对本修订声明的名字有意义；空的 replace 等于没写，不发送；clear 也允许针对已取消声明的名字。 */
function credentialWrites(draft: ProfileDraft): Record<string, CredentialOp> {
  return Object.fromEntries(Object.entries(draft.credentials).filter(([name, op]) => op.op === 'clear' || (draft.secretNames.includes(name) && (op.op === 'keep' || op.value !== ''))));
}

export function toCreateRequest(draft: ProfileDraft): CreateComputeProfileInput {
  return { name: draft.name.trim(), description: draft.description, content: toContent(draft), credentials: credentialWrites(draft) };
}

export function toSaveRequest(draft: ProfileDraft, expectedRevision: number): SaveComputeProfileInput {
  return { expectedRevision, description: draft.description, content: toContent(draft), credentials: credentialWrites(draft) };
}

export function draftDirty(a: ProfileDraft, b: ProfileDraft): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}
