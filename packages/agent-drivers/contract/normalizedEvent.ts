// ← agent-workflow `services/runtime/types.ts:129-220` 的 NormalizedEvent 段。
// 两个 CLI 的 stdout 先归一成这一种事件，再由 agentEventMapping.ts 映射为契约里的 AgentEvent。
// 与源的差异：
//  - 删掉 `startup_inventory` 种类与 `data.inventory`（清单插件面不复制，见 index.ts 的「不复制」清单）；
//  - 新增 `tool`：源只判定 kind、不展开工具参数（树形渲染在别处再解析一遍原始行），
//    而 CrewStation 的 AgentEvent 契约有 `tool` 字段，工作台直接消费，于是在同一次解析里顺手取出；
//  - 新增 `terminalError`：源用独立的 `parseResultError(line)` 再解析一遍同一行，这里合并。

export type NormalizedEventKind =
  | 'tool_use'
  | 'tool_result'
  | 'text'
  | 'reasoning'
  | 'permission_asked'
  | 'error'
  | 'step_start'
  | 'step_finish';

export interface NormalizedTokenDelta {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

/** 工具调用／回执的展开；两个 CLI 能取到多少取多少，取不到就只有 name。 */
export interface NormalizedToolCall {
  callId?: string;
  name: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
}

export interface NormalizedEvent {
  kind: NormalizedEventKind;
  /** 贡献给输出的可见文本；无则 null。 */
  text?: string | null;
  /** 根会话的原生 id（子代理侧链帧必须省略），出现后即可用于 resume。 */
  sessionId?: string;
  /** ms epoch；缺省由泵回退到当前时间。 */
  timestamp?: number;
  tokens?: NormalizedTokenDelta;
  tool?: NormalizedToolCall;
  /** 终止事件自报的应用级错误（Claude 的 `result.is_error`）。 */
  terminalError?: { isError: boolean; message: string };
  /** 原始 stdout 行，只用于排障与追溯，不作为契约。 */
  rawLine: string;
}

/** 源 `SystemEventObservation`：给落库与终止判定用的粗粒度观测。 */
export interface SystemEventObservation {
  runtimeEventType: string | null;
  terminalResult: 'success' | 'error' | null;
}

/** 运行时事件类型名的白名单形状（源：`/^[A-Za-z0-9._-]{1,64}$/`）。 */
export const SAFE_RUNTIME_EVENT_TYPE = /^[A-Za-z0-9._-]{1,64}$/;

export function numOrZero(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** 解析一行 JSON；非 JSON、非对象、数组一律 null（源的三处解析都是这个前置判定）。 */
export function parseJsonObjectLine(line: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}
