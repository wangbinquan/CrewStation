// ← agent-workflow `runtime/claudeCode/permissionMap.ts`（190 行），原样移植。
//
// opencode 把**动作类**分三档，Claude 是按名字裁剪一份**已加载工具集**，两者没有自然双射，
// 所以这张表是显式的、被测试锁住的契约，不是推断出来的。源的三条裁定原样保留：
//  - headless 下没人能应答，`ask` 一律按 `deny` 处理并告警；
//  - 未知键 fail closed：什么都不授予；
//  - `Record<pattern, 动作>` 无法用「载入集裁剪」表达，降级为「任一 pattern 为 allow 即整工具加载」并告警。

import type { OpencodePermissionAction, OpencodePermissionMap } from './opencodePermission';
import { OPENCODE_PERMISSION_ACTIONS, OPENCODE_PERMISSION_WILDCARD_KEY } from './opencodePermission';

/** 平台愿意授予的 Claude 内置工具。 */
const GRANTABLE = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'Task', 'WebFetch', 'WebSearch', 'Skill'] as const;
export type GrantableClaudeTool = (typeof GRANTABLE)[number];

/**
 * 稳定映射表。键是 opencode 权限键，值是该键管辖的 Claude 工具；表里没有的键什么都不授予。
 * `edit` 覆盖全部写面（Edit／Write／NotebookEdit），否则 `edit: deny` 的 Agent 仍能用 Write 建文件；
 * `list`、`external_directory`、`todowrite`、`question`、`lsp`、`doom_loop` 在 Claude 侧没有对应工具。
 */
const TABLE: Readonly<Record<string, readonly GrantableClaudeTool[]>> = Object.freeze({
  read: ['Read'], glob: ['Glob'], grep: ['Grep'], edit: ['Edit', 'Write', 'NotebookEdit'],
  bash: ['Bash'], task: ['Task'], webfetch: ['WebFetch'], websearch: ['WebSearch'], skill: ['Skill'],
  list: [], external_directory: [], todowrite: [], question: [], lsp: [], doom_loop: [],
});

export interface ClaudeToolGate {
  /** `--tools` 的值：通过映射的工具，顺序固定为表序，argv 因此可确定复现。 */
  tools: readonly GrantableClaudeTool[];
  /** 调用方必须呈现的告警，绝不静默。 */
  warnings: readonly string[];
}

function actionOf(rule: unknown): { action: OpencodePermissionAction; patterned: boolean } | null {
  if (typeof rule === 'string' && (OPENCODE_PERMISSION_ACTIONS as readonly string[]).includes(rule)) {
    return { action: rule as OpencodePermissionAction, patterned: false };
  }
  if (rule !== null && typeof rule === 'object' && !Array.isArray(rule)) {
    const anyAllow = Object.values(rule as Record<string, unknown>).some((v) => v === 'allow');
    return { action: anyAllow ? 'allow' : 'deny', patterned: true };
  }
  return null;
}

function applyWildcard(rule: unknown, granted: Set<GrantableClaudeTool>, warnings: string[]): void {
  const resolved = actionOf(rule);
  if (resolved === null) return;
  if (resolved.action === 'ask') {
    warnings.push("permission '*': headless 下 'ask' 无意义，按 'deny' 处理");
    return;
  }
  if (resolved.action === 'allow') for (const tool of GRANTABLE) granted.add(tool);
}

function applyKey(key: string, rule: unknown, granted: Set<GrantableClaudeTool>, warnings: string[]): void {
  const mapped = TABLE[key];
  if (mapped === undefined) {
    warnings.push(`permission '${key}': 未知键 —— 在 claude-code 上什么都不授予`);
    return;
  }
  const resolved = actionOf(rule);
  if (resolved === null) {
    warnings.push(`permission '${key}': 值无法识别，按 'deny' 处理`);
    for (const tool of mapped) granted.delete(tool);
    return;
  }
  if (resolved.patterned) {
    const verdict = resolved.action === 'allow' ? '整体加载（有 pattern 放行）' : '整体不加载';
    warnings.push(`permission '${key}': 逐 pattern 规则无法表达为 claude 载入集，${verdict}`);
  }
  if (resolved.action === 'ask') warnings.push(`permission '${key}': headless 下 'ask' 无意义，按 'deny' 处理`);
  if (resolved.action === 'allow') for (const tool of mapped) granted.add(tool);
  else for (const tool of mapped) granted.delete(tool);
}

/**
 * 把一个 permission map 翻译成 Claude 的载入集。
 * `'*'`（opencode 归一后的裸动作）先给全部可授予工具定基线，随后显式键覆盖；
 * 没有 `'*'` 时基线是 deny —— Claude 侧必须显式授予，不做假设。
 */
export function mapAgentPermissionToClaudeTools(permission: OpencodePermissionMap): ClaudeToolGate {
  const warnings: string[] = [];
  const granted = new Set<GrantableClaudeTool>();
  if (OPENCODE_PERMISSION_WILDCARD_KEY in permission) {
    applyWildcard(permission[OPENCODE_PERMISSION_WILDCARD_KEY], granted, warnings);
  }
  for (const [key, rule] of Object.entries(permission)) {
    if (key === OPENCODE_PERMISSION_WILDCARD_KEY) continue;
    applyKey(key, rule, granted, warnings);
  }
  const tools = GRANTABLE.filter((tool) => granted.has(tool));
  if (tools.length === 0 && Object.keys(permission).length > 0) {
    warnings.push(
      "permission 未授予任何 claude 内置工具：节点将一个都不加载（claude 的基线是 deny-unless-granted，" +
        "与 opencode 的 allow-unless-denied 相反）。加 '*': 'allow' 或显式授予工具。",
    );
  }
  return { tools, warnings };
}

/** `--tools` 的 argv 值；空串是 CLI 文档化的「禁用全部内置工具」。 */
export function claudeToolsValue(gate: ClaudeToolGate): string {
  return gate.tools.join(',');
}

/** 空 map ⇒ null ⇒ 调用方用 `--permission-mode bypassPermissions`；非空 ⇒ 翻译成载入集。 */
export function claudeToolGateFor(permission: OpencodePermissionMap | undefined): ClaudeToolGate | null {
  const declared = permission ?? {};
  if (Object.keys(declared).length === 0) return null;
  return mapAgentPermissionToClaudeTools(declared);
}
