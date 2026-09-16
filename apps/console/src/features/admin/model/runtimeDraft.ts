import type { BeforeStartStep, RuntimeConfigDetailDto, RuntimeConfigRevisionDto, ScriptLanguage } from '@crewstation/contracts';
import { BEFORE_START_LIMITS, EnvNameSchema, StepIdSchema } from '@crewstation/contracts';
import type { SaveRuntimeDraftInput } from '@crewstation/api-client';

/** 编辑器里的一步：两种动作的字段并存，只按 kind 读取；数字与数组一律用字符串承载，保存时再转换。 */
export interface StepDraft {
  kind: 'file' | 'script';
  stepId: string;
  name: string;
  pathTemplate: string;
  contentTemplate: string;
  format: 'text' | 'json' | 'jsonc';
  /** 八进制文本，如 600。 */
  mode: string;
  existing: 'require-same' | 'replace';
  language: ScriptLanguage;
  source: string;
  /** 每行一个 argv 元素；custom 的第一行是可执行文件绝对路径。 */
  interpreter: string;
  argv: string;
  cwdTemplate: string;
  timeoutSeconds: string;
}

export type CredentialOp = { op: 'keep' } | { op: 'replace'; value: string } | { op: 'clear' };

export interface RuntimeDraft {
  description: string;
  steps: StepDraft[];
  vars: Array<{ name: string; value: string }>;
  secretNames: string[];
  credentials: Record<string, CredentialOp>;
  configFileKind: 'none' | 'claude-settings' | 'opencode-config';
  configFilePath: string;
  defaultModel: string;
  /** 每行一个模型名。 */
  models: string;
}

export type DraftErrors = Record<string, string>;

const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

export function stepFromDto(step: BeforeStartStep): StepDraft {
  const base: StepDraft = { kind: step.kind, stepId: step.stepId, name: step.name, pathTemplate: '', contentTemplate: '', format: 'text', mode: '600', existing: 'require-same', language: 'shell', source: '', interpreter: '', argv: '', cwdTemplate: '', timeoutSeconds: String(BEFORE_START_LIMITS.defaultScriptTimeoutMs / 1000) };
  if (step.kind === 'file') return { ...base, pathTemplate: step.pathTemplate, contentTemplate: step.contentTemplate, format: step.format, mode: step.mode.toString(8), existing: step.existing };
  return { ...base, language: step.language, source: step.source, interpreter: (step.interpreter ?? []).join('\n'), argv: step.argv.join('\n'), cwdTemplate: step.cwdTemplate ?? '', timeoutSeconds: String(Math.round(step.timeoutMs / 1000)) };
}

export function draftFromRevision(detail: RuntimeConfigDetailDto, revision: RuntimeConfigRevisionDto = detail.draft): RuntimeDraft {
  return {
    description: detail.description, steps: revision.steps.map(stepFromDto), vars: Object.entries(revision.vars).map(([name, value]) => ({ name, value })),
    secretNames: [...revision.secretNames], credentials: Object.fromEntries(revision.secretNames.map((name) => [name, { op: 'keep' as const }])),
    configFileKind: revision.configFile.kind, configFilePath: revision.configFile.kind === 'none' ? '' : revision.configFile.pathTemplate,
    defaultModel: revision.defaultModel ?? '', models: revision.models.join('\n'),
  };
}

export const SCRIPT_EXAMPLES: Record<ScriptLanguage, string> = {
  shell: 'set -eu\n# 输入：声明的变量与凭据在环境里；输出经 CS_HOOK_ENV_OUT 写 JSON 字符串映射。\nprintf \'{"EXAMPLE_TOKEN":"%s"}\' "$(date +%s)" > "$CS_HOOK_ENV_OUT"\n',
  python: 'import json, os\n# 输入：环境变量；输出：向 CS_HOOK_ENV_OUT 写入 {"NAME": "value"}。\nwith open(os.environ["CS_HOOK_ENV_OUT"], "w") as f:\n    json.dump({"EXAMPLE_TOKEN": "value"}, f)\n',
  javascript: '// bun 运行；输入：process.env；输出：写 CS_HOOK_ENV_OUT。\nawait Bun.write(process.env.CS_HOOK_ENV_OUT, JSON.stringify({ EXAMPLE_TOKEN: "value" }));\n',
  custom: '# 由自定义解释器执行；解释器路径写在“解释器”里，一行一个参数。\n',
};

export function newStep(kind: StepDraft['kind'], existing: readonly StepDraft[]): StepDraft {
  let n = existing.length + 1;
  while (existing.some((s) => s.stepId === `${kind}-${n}`)) n += 1;
  const stepId = `${kind}-${n}`;
  const base = stepFromDto(kind === 'file'
    ? { kind: 'file', stepId, name: '', pathTemplate: '{{agent.home}}/', contentTemplate: '', format: 'text', mode: 0o600, existing: 'require-same' }
    : { kind: 'script', stepId, name: '', language: 'shell', source: SCRIPT_EXAMPLES.shell, argv: [], timeoutMs: BEFORE_START_LIMITS.defaultScriptTimeoutMs });
  return base;
}

export function moveStep(steps: StepDraft[], index: number, delta: -1 | 1): StepDraft[] {
  const target = index + delta;
  if (target < 0 || target >= steps.length) return steps;
  const next = [...steps];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function duplicateStep(steps: StepDraft[], index: number): StepDraft[] {
  const source = steps[index];
  if (!source) return steps;
  let n = 2;
  while (steps.some((s) => s.stepId === `${source.stepId}-${n}`)) n += 1;
  const copy = { ...source, stepId: `${source.stepId}-${n}`, name: `${source.name} (2)` };
  return [...steps.slice(0, index + 1), copy, ...steps.slice(index + 1)];
}

/** 客户端只做能即时定位的校验；模板变量声明、JSON 结构由服务端逐字段回报。 */
export function validateDraft(draft: RuntimeDraft): DraftErrors {
  const errors: DraftErrors = {};
  const ids = new Set<string>();
  draft.steps.forEach((step, i) => {
    if (!StepIdSchema.safeParse(step.stepId).success) errors[`steps.${i}.stepId`] = 'stepId';
    if (ids.has(step.stepId)) errors[`steps.${i}.stepId`] = 'stepIdDuplicate';
    ids.add(step.stepId);
    if (!step.name.trim()) errors[`steps.${i}.name`] = 'nameRequired';
    if (step.kind === 'file') {
      if (!step.pathTemplate.trim()) errors[`steps.${i}.pathTemplate`] = 'pathRequired';
      if (!step.contentTemplate) errors[`steps.${i}.contentTemplate`] = 'contentRequired';
      if (!/^[0-7]{3,4}$/.test(step.mode)) errors[`steps.${i}.mode`] = 'mode';
    } else {
      if (!step.source) errors[`steps.${i}.source`] = 'sourceRequired';
      const seconds = Number(step.timeoutSeconds);
      if (!Number.isInteger(seconds) || seconds * 1000 < BEFORE_START_LIMITS.minScriptTimeoutMs || seconds * 1000 > BEFORE_START_LIMITS.maxScriptTimeoutMs) errors[`steps.${i}.timeoutSeconds`] = 'timeout';
      if (step.language === 'custom' && !lines(step.interpreter)[0]?.startsWith('/')) errors[`steps.${i}.interpreter`] = 'interpreter';
    }
  });
  const varNames = new Set<string>();
  draft.vars.forEach((v, i) => {
    if (!EnvNameSchema.safeParse(v.name).success) errors[`vars.${i}.name`] = 'envName';
    else if (varNames.has(v.name) || draft.secretNames.includes(v.name)) errors[`vars.${i}.name`] = 'envNameDuplicate';
    varNames.add(v.name);
  });
  draft.secretNames.forEach((name, i) => { if (!EnvNameSchema.safeParse(name).success) errors[`secrets.${i}`] = 'envName'; });
  if (draft.configFileKind !== 'none' && !draft.configFilePath.trim()) errors.configFilePath = 'pathRequired';
  if (draft.defaultModel && lines(draft.models).length && !lines(draft.models).includes(draft.defaultModel.trim())) errors.defaultModel = 'defaultModel';
  return errors;
}

export function toSaveRequest(draft: RuntimeDraft, expectedRevision: number): SaveRuntimeDraftInput {
  const steps: BeforeStartStep[] = draft.steps.map((s) => s.kind === 'file'
    ? { kind: 'file', stepId: s.stepId, name: s.name.trim(), pathTemplate: s.pathTemplate.trim(), contentTemplate: s.contentTemplate, format: s.format, mode: parseInt(s.mode, 8), existing: s.existing }
    : { kind: 'script', stepId: s.stepId, name: s.name.trim(), language: s.language, source: s.source, ...(s.language === 'custom' ? { interpreter: lines(s.interpreter) } : {}), argv: lines(s.argv), ...(s.cwdTemplate.trim() ? { cwdTemplate: s.cwdTemplate.trim() } : {}), timeoutMs: Number(s.timeoutSeconds) * 1000 });
  // keep／replace 只对本版本声明的名字有意义；clear 也允许针对已取消声明的名字，用来删掉遗留密文。
  const credentials = Object.fromEntries(Object.entries(draft.credentials).filter(([name, op]) => op.op === 'clear' || draft.secretNames.includes(name)));
  return {
    expectedRevision, description: draft.description, steps, vars: Object.fromEntries(draft.vars.map((v) => [v.name, v.value])), secretNames: draft.secretNames, credentials,
    configFile: draft.configFileKind === 'none' ? { kind: 'none' } : { kind: draft.configFileKind, pathTemplate: draft.configFilePath.trim() },
    ...(draft.defaultModel.trim() ? { defaultModel: draft.defaultModel.trim() } : {}), models: lines(draft.models),
  };
}

const SAMPLE_CONTEXT: Record<string, string> = { 'agent.home': '/tmp/crewstation-agents/agt_…/home', 'agent.runDir': '/tmp/crewstation-agents/agt_…', 'agent.id': 'agt_…', workspace: '/work' };

/** 路径预览：用示例上下文展开，并判断是每 Agent 私有还是同容器共享的固定路径。 */
export function previewPath(template: string): { path: string; scope: 'private' | 'shared' | 'invalid' } {
  const trimmed = template.trim();
  if (!trimmed) return { path: '', scope: 'invalid' };
  const path = trimmed.startsWith('~/') ? `${SAMPLE_CONTEXT['agent.home']}/${trimmed.slice(2)}` : trimmed.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g, (raw, name: string) => SAMPLE_CONTEXT[name] ?? (name.startsWith('vars.') || name.startsWith('secrets.') || name.startsWith('env.') ? `<${name}>` : raw));
  if (!path.startsWith('/')) return { path, scope: 'invalid' };
  return { path, scope: path.startsWith('/tmp/crewstation-agents/') ? 'private' : 'shared' };
}

export function draftDirty(a: RuntimeDraft, b: RuntimeDraft): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}
