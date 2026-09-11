// ← agent-workflow `runtime/opencode/events.ts`，`--format json` 行 → NormalizedEvent。
// 与源的差异：新增 `tool` 的尽力提取（源只判定 kind）；其余（文本提取、kind 推断、token 累计）原样。

import type {
  NormalizedEvent,
  NormalizedEventKind,
  NormalizedToolCall,
  NormalizedTokenDelta,
  SystemEventObservation,
} from '../../contract/normalizedEvent';
import { SAFE_RUNTIME_EVENT_TYPE, numOrZero, parseJsonObjectLine } from '../../contract/normalizedEvent';

export function observeSystemEvent(line: string): SystemEventObservation {
  const event = parseJsonObjectLine(line);
  if (event === null) return { runtimeEventType: null, terminalResult: null };
  const rawType = event.type;
  const runtimeEventType = typeof rawType === 'string' && SAFE_RUNTIME_EVENT_TYPE.test(rawType) ? rawType : null;
  return { runtimeEventType, terminalResult: runtimeEventType === 'step_finish' ? 'success' : null };
}

/** 解析一行。非 JSON 或解析成 falsy（null／0／""／false）→ null，由调用方走「原样文本」路径。 */
export function parseEvent(line: string): NormalizedEvent | null {
  const evt = parseJsonObjectLine(line);
  if (evt === null) return null;
  const tool = extractToolCall(evt);
  return {
    kind: inferEventKind(evt),
    text: extractTextFromEvent(evt),
    // 与 Claude 不同：opencode 每个事件的顶层 `sessionID` 就是会话 id，没有根／侧链之分。
    ...(typeof evt.sessionID === 'string' ? { sessionId: evt.sessionID } : {}),
    ...(tool === undefined ? {} : { tool }),
    ...(typeof evt.timestamp === 'number' ? { timestamp: evt.timestamp } : {}),
    tokens: computeTokenDelta(evt) ?? undefined,
    rawLine: line,
  };
}

/** 不同 opencode 版本／part 种类把文本放在不同位置，容忍常见几种。 */
export function extractTextFromEvent(evt: Record<string, unknown>): string | null {
  const part = evt.part as Record<string, unknown> | undefined;
  if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') return part.text;
  if (evt.type === 'text' && typeof evt.text === 'string') return evt.text;
  return null;
}

export function inferEventKind(evt: Record<string, unknown>): NormalizedEventKind {
  const t = evt.type;
  if (typeof t === 'string') {
    if (t === 'tool_use') return 'tool_use';
    if (t === 'text') return 'text';
    if (t === 'reasoning') return 'reasoning';
    if (t === 'permission.asked' || t === 'permission_asked') return 'permission_asked';
    if (t === 'error') return 'error';
    if (t === 'step_start') return 'step_start';
    if (t === 'step_finish') return 'step_finish';
  }
  return 'text';
}

/**
 * 工具名的尽力提取：源不做这件事，opencode 的工具事件形状也没有被源的注释锁定过，
 * 因此这里只按几处常见位置找名字与回执，找不到就不产出 `tool`（rawLine 仍然完整）。
 */
function extractToolCall(evt: Record<string, unknown>): NormalizedToolCall | undefined {
  if (inferEventKind(evt) !== 'tool_use') return undefined;
  const part = (evt.part && typeof evt.part === 'object' ? evt.part : {}) as Record<string, unknown>;
  const name = firstString([evt.tool, part.tool, evt.name, part.name]);
  if (name === undefined) return undefined;
  const callId = firstString([evt.callID, evt.callId, part.callID, part.id, evt.id]);
  const state = (part.state && typeof part.state === 'object' ? part.state : {}) as Record<string, unknown>;
  return {
    ...(callId === undefined ? {} : { callId }),
    name,
    ...(state.input === undefined ? {} : { input: state.input }),
    ...(state.output === undefined ? {} : { output: state.output }),
    ...(state.status === 'error' ? { isError: true } : {}),
  };
}

function firstString(candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return undefined;
}

/**
 * 逐事件的 token 增量。opencode 把用量放在好几处，按优先级探：
 * `evt.tokens` → `evt.part.tokens` → `evt.usage` → `evt.step.tokens` → `evt.message.usage`；
 * 每处同时接受 snake_case 与 camelCase。没有 token 字段时返回 null。
 */
export function computeTokenDelta(evt: Record<string, unknown>): NormalizedTokenDelta | null {
  const tokens = pickTokens([
    evt,
    evt.part as Record<string, unknown> | undefined,
    evt.usage as Record<string, unknown> | undefined,
    evt.step as Record<string, unknown> | undefined,
    evt.message as Record<string, unknown> | undefined,
  ]);
  if (!tokens) return null;
  const input = numOrZero(tokens.input ?? tokens.input_tokens ?? tokens.prompt_tokens);
  const output = numOrZero(tokens.output ?? tokens.output_tokens ?? tokens.completion_tokens);
  // opencode 1.15.5+ 把缓存计数嵌在 `cache: { read, write }` 下；旧的扁平 `cache_read`／`cache_creation`
  // 作为回退保留 —— 只读扁平键会静默丢掉缓存 token（源实测约 15 倍低估）。
  const cache = tokens.cache as Record<string, unknown> | undefined;
  return {
    input,
    output,
    cacheCreate: numOrZero(tokens.cache_creation ?? tokens.cacheCreation ?? cache?.write),
    cacheRead: numOrZero(tokens.cache_read ?? tokens.cacheRead ?? cache?.read),
  };
}

function pickTokens(candidates: Array<Record<string, unknown> | undefined>): Record<string, unknown> | null {
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const tokens = candidate.tokens;
    if (tokens && typeof tokens === 'object') return tokens as Record<string, unknown>;
    if (hasInlineCounts(candidate)) return candidate;
    const usage = candidate.usage;
    if (usage && typeof usage === 'object') {
      const u = usage as Record<string, unknown>;
      if (typeof u.input === 'number' || typeof u.output === 'number' || hasInlineCounts(u)) return u;
    }
  }
  return null;
}

function hasInlineCounts(value: Record<string, unknown>): boolean {
  return typeof value.input_tokens === 'number' || typeof value.output_tokens === 'number'
    || typeof value.prompt_tokens === 'number' || typeof value.completion_tokens === 'number';
}
