import type { BeforeStartStep, ComputeProfileContent, TemplateReference } from '@crewstation/contracts';
import { BEFORE_START_LIMITS, TEMPLATE_PATH_CONTEXT_NAMES, scanTemplate } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';

/** 档位修订里属于启动前 Hook 的那部分内容（RFC-004 的步骤、变量、凭据与配置绑定，RFC-006 并入档位）。 */
export type BeforeStartContent = Pick<ComputeProfileContent, 'steps' | 'vars' | 'secretNames' | 'configFile'>;

/** 保留给平台的环境变量：脚本输出与普通变量都不能覆盖，冲突时显示变量名。 */
export const RESERVED_ENV_NAMES: ReadonlySet<string> = new Set([
  'HOME', 'USER', 'LOGNAME', 'PATH', 'PWD', 'CS_AGENT_ID', 'CS_AGENT_HOME', 'CS_AGENT_RUN_DIR', 'CS_WORKDIR', 'CS_HOOK_ENV_OUT',
  'CS_RUNNER_TOKEN', 'CS_SESSION_URL', 'CS_TASK_ID', 'CS_TRACE_ID', 'CLAUDE_CONFIG_DIR', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG_CONTENT',
]);
export const RESERVED_ENV_PREFIXES: readonly string[] = ['CS_RUNNER_', 'CS_MCP_', 'OTEL_'];

export function isReservedEnvName(name: string): boolean {
  return RESERVED_ENV_NAMES.has(name) || RESERVED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
}

const bytes = (text: string) => Buffer.byteLength(text, 'utf8');
const fail = (message: string, stepId: string | undefined, field: string) => validation(message, { ...(stepId ? { stepId } : {}), field });

/**
 * 保存时校验档位修订的启动前内容：尺寸、变量声明、路径形态、JSON 模板结构。
 * 只检查能静态判定的部分；实际落点、权限与格式在容器内展开后再校验一次。
 */
export function validateRevisionContent(content: BeforeStartContent): void {
  let total = 0;
  for (const [name, value] of Object.entries(content.vars)) {
    if (isReservedEnvName(name)) throw fail(`变量 ${name} 是平台保留名，不能作为普通变量`, undefined, `vars.${name}`);
    total += bytes(name) + bytes(value);
  }
  for (const name of content.secretNames) {
    if (isReservedEnvName(name)) throw fail(`凭据 ${name} 是平台保留名`, undefined, `secretNames`);
    if (name in content.vars) throw fail(`${name} 同时出现在普通变量与凭据中，只能选一处`, undefined, `secretNames`);
  }
  const outputs = new Set<string>();
  for (const step of content.steps) {
    total += validateStep(step, content, outputs);
    if (step.kind === 'script') outputs.add(step.stepId);
  }
  if (content.configFile.kind !== 'none') {
    const path = content.configFile.pathTemplate;
    assertPathTemplate(path, undefined, 'configFile.pathTemplate');
    assertReferences(path, content, undefined, 'configFile.pathTemplate', true);
    if (!content.steps.some((s) => s.kind === 'file' && s.pathTemplate === path)) throw fail(`配置绑定的路径 ${path} 没有对应的文件步骤；由脚本生成时请在绑定里使用脚本写出的同一路径并把它也登记为文件步骤，或改为 none`, undefined, 'configFile.pathTemplate');
  }
  if (total > BEFORE_START_LIMITS.maxConfigBytes) throw fail(`档位启动前内容 ${total} 字节，超过 ${BEFORE_START_LIMITS.maxConfigBytes} 字节上限`, undefined, 'steps');
}

function validateStep(step: BeforeStartStep, content: BeforeStartContent, priorScripts: Set<string>): number {
  const allowEnv = priorScripts.size > 0;
  if (step.kind === 'file') {
    if (bytes(step.contentTemplate) > BEFORE_START_LIMITS.maxTextBytes) throw fail(`文件模板超过 ${BEFORE_START_LIMITS.maxTextBytes} 字节`, step.stepId, 'contentTemplate');
    assertPathTemplate(step.pathTemplate, step.stepId, 'pathTemplate');
    assertReferences(step.pathTemplate, content, step.stepId, 'pathTemplate', allowEnv);
    assertReferences(step.contentTemplate, content, step.stepId, 'contentTemplate', allowEnv);
    if (step.format !== 'text') assertJsonTemplate(step.contentTemplate, step.format, step.stepId);
    return bytes(step.contentTemplate) + bytes(step.pathTemplate);
  }
  if (bytes(step.source) > BEFORE_START_LIMITS.maxTextBytes) throw fail(`脚本正文超过 ${BEFORE_START_LIMITS.maxTextBytes} 字节`, step.stepId, 'source');
  if (step.cwdTemplate) {
    assertPathTemplate(step.cwdTemplate, step.stepId, 'cwdTemplate');
    assertReferences(step.cwdTemplate, content, step.stepId, 'cwdTemplate', allowEnv);
  }
  if (step.language === 'custom' && !step.interpreter?.[0]?.startsWith('/')) throw fail('自定义解释器必须是容器内绝对路径', step.stepId, 'interpreter');
  return bytes(step.source);
}

/** 路径必须是容器内绝对路径，或以固定上下文变量开头；`~` 只接受 `~/`（相对 agent.home）。 */
export function assertPathTemplate(template: string, stepId: string | undefined, field: string): void {
  if (template.includes('\0')) throw fail('路径包含非法字符', stepId, field);
  const ok = template.startsWith('/') || template.startsWith('~/') || TEMPLATE_PATH_CONTEXT_NAMES.some((name) => new RegExp(`^\\{\\{\\s*${name.replace('.', '\\.')}\\s*\\}\\}`).test(template));
  if (!ok) throw fail(`路径 ${template} 必须是绝对路径、以 ~/ 开头，或以 {{agent.home}}／{{agent.runDir}}／{{workspace}} 开头`, stepId, field);
  if (/(^|\/)\.\.(\/|$)/.test(template)) throw fail(`路径 ${template} 不能包含 ..`, stepId, field);
}

function assertReferences(template: string, content: BeforeStartContent, stepId: string | undefined, field: string, allowEnv: boolean): void {
  for (const token of scanTemplate(template)) {
    const ref = token.reference;
    if (!ref) throw fail(`无法识别的模板变量 ${token.raw}`, stepId, field);
    if (!isDeclared(ref, content, allowEnv)) throw fail(`模板变量 ${token.raw} 未声明${ref.kind === 'env' ? '：{{env.X}} 只能引用之前脚本步骤的输出' : ''}`, stepId, field);
  }
}

function isDeclared(ref: TemplateReference, content: BeforeStartContent, allowEnv: boolean): boolean {
  if (ref.kind === 'context') return true;
  if (ref.kind === 'vars') return ref.name in content.vars;
  if (ref.kind === 'secrets') return content.secretNames.includes(ref.name);
  return allowEnv && !isReservedEnvName(ref.name);
}

/** JSON／JSONC 模板：把每个占位替换为合法字符串后必须能解析，占位只能落在字符串值里。 */
export function assertJsonTemplate(template: string, format: 'json' | 'jsonc', stepId: string): void {
  // 先判占位位置：引号外的占位替换成 x 后必然解析失败，但那条报错会把真正的原因（结构位置）说成语法错误。
  const body = format === 'jsonc' ? stripJsonComments(template) : template;
  if (!placeholdersInsideStrings(body)) throw fail('JSON 模板的变量只能出现在字符串值里，不能替代键名、数字或整段结构', stepId, 'contentTemplate');
  const probe = body.replace(/\{\{\s*[A-Za-z_][A-Za-z0-9_.]*\s*\}\}/g, 'x');
  try {
    JSON.parse(probe);
  } catch (error) {
    throw fail(`${format.toUpperCase()} 模板不是合法文档：${error instanceof Error ? error.message : String(error)}`, stepId, 'contentTemplate');
  }
}

export function placeholdersInsideStrings(template: string): boolean {
  let inString = false, escaped = false;
  for (let i = 0; i < template.length; i += 1) {
    const ch = template[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' && template[i + 1] === '{') return false;
  }
  return true;
}

/** 去掉行注释（双斜杠）与块注释；字符串内的斜杠保留。 */
export function stripJsonComments(text: string): string {
  let out = '', inString = false, escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!, next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i += 1; out += '\n'; continue; }
    if (ch === '/' && next === '*') { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 1; continue; }
    out += ch;
  }
  return out;
}
