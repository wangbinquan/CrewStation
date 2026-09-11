/**
 * GitLab webhook → 平台事件类型的映射（Design §8.5）。
 * 事件类型必须落在 crewstation.yaml `spec.produces` 登记的封闭集合里：cs-events 对未登记的类型返回 404，
 * 所以这里对动作／状态用白名单，白名单外一律退回两段式基础类型，绝不即兴拼出没登记过的类型。
 * 类型写法遵守平台 Schema（packages/contracts/manifest/serviceSpec.ts）：小写短横线分段，形如 `gitlab.pipeline.success`。
 */

/** GitLab 在每次 webhook 上带的钩子名请求头。 */
export const GITLAB_EVENT_HEADER = 'x-gitlab-event';

/** 与 crewstation.yaml `spec.producer` 一致。 */
export const PRODUCER_NAME = 'gitlab';

/** 合并请求的动作白名单（payload `object_attributes.action`）。 */
const MERGE_REQUEST_ACTIONS = ['open', 'close', 'reopen', 'update', 'merge', 'approved', 'unapproved'] as const;
/** 流水线状态白名单（payload `object_attributes.status`）。 */
const PIPELINE_STATUSES = ['created', 'pending', 'running', 'success', 'failed', 'canceled', 'skipped', 'manual'] as const;
/** 议题的动作白名单（payload `object_attributes.action`）。 */
const ISSUE_ACTIONS = ['open', 'close', 'reopen', 'update'] as const;

interface HookRule {
  /** 两段式基础类型：没有可识别动作时用它。 */
  readonly base: string;
  /** 细分动作取自 payload 的哪个 `object_attributes` 字段。 */
  readonly refineField?: 'action' | 'status';
  /** 允许出现在第三段的取值；其余一律退回 base。 */
  readonly refinements?: readonly string[];
}

/** 受支持的钩子；键是 `x-gitlab-event` 请求头的值（大小写与空格已归一化）。 */
const HOOK_RULES: Readonly<Record<string, HookRule>> = {
  'push hook': { base: 'gitlab.push' },
  'tag push hook': { base: 'gitlab.tag-push' },
  'merge request hook': { base: 'gitlab.merge-request', refineField: 'action', refinements: MERGE_REQUEST_ACTIONS },
  'pipeline hook': { base: 'gitlab.pipeline', refineField: 'status', refinements: PIPELINE_STATUSES },
  'issue hook': { base: 'gitlab.issue', refineField: 'action', refinements: ISSUE_ACTIONS },
};

export type EventTypeResult =
  | { ok: true; eventType: string; hook: string }
  | { ok: false; reason: string };

/** 归一化钩子名：GitLab 写作 `Push Hook`，容错大小写与多余空白。 */
export function normalizeHookName(headerValue: string | null | undefined): string {
  return (headerValue ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * 由 `x-gitlab-event` 请求头加 payload 推出事件类型。
 * 不认识的钩子返回 ok:false：调用方应当以 2xx 回应 GitLab（不是错误，只是本接入容器不产生该事件），避免无意义重投。
 */
export function mapEventType(headerValue: string | null | undefined, payload: unknown): EventTypeResult {
  const hook = normalizeHookName(headerValue);
  if (hook.length === 0) return { ok: false, reason: `缺少 ${GITLAB_EVENT_HEADER} 请求头，无法判断事件类型` };
  const rule = HOOK_RULES[hook];
  if (!rule) return { ok: false, reason: `本接入容器不产生 ${hook} 的事件；已登记的钩子：${Object.keys(HOOK_RULES).join('、')}` };
  return { ok: true, hook, eventType: refine(rule, payload) };
}

function refine(rule: HookRule, payload: unknown): string {
  if (!rule.refineField || !rule.refinements) return rule.base;
  const attributes = readRecord(readRecord(payload)?.object_attributes);
  const value = attributes?.[rule.refineField];
  if (typeof value !== 'string') return rule.base;
  const hit = rule.refinements.find((item) => item === value.trim().toLowerCase());
  return hit ? `${rule.base}.${hit}` : rule.base;
}

/**
 * 本接入容器可能产生的全部事件类型。
 * crewstation.yaml `spec.produces` 必须与它逐项一致——src/gitlab/eventType.test.ts 会比对，改一处就得改另一处。
 */
export function allEventTypes(): string[] {
  const out: string[] = [];
  for (const rule of Object.values(HOOK_RULES)) {
    out.push(rule.base);
    for (const refinement of rule.refinements ?? []) out.push(`${rule.base}.${refinement}`);
  }
  return out;
}

export function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
