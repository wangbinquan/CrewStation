// ← agent-workflow `runtime/claudeCode/events.ts`，stream-json 行 → NormalizedEvent。
//
// 事件形状按源的注释验证于 claude 2.1.193／2.1.202／2.1.226/227：
//   {type:'system', subtype:'init'|'status'|…, session_id, tools[], agents[], skills[], mcp_servers[]}
//   {type:'assistant', message:{id, content:[{type:'text'|'thinking'|'tool_use',…}], usage:{…}}, parent_tool_use_id, session_id}
//   {type:'user', message:{content:[{type:'tool_result',…}]|string}, session_id}
//   {type:'result', subtype:'success', is_error, result, session_id, usage:{…}}
// 与源的差异：
//  - 删掉 `inventoryFacesFromInitEvent`（清单对账面不复制）；
//  - `parseResultError` 合并进 NormalizedEvent.terminalError（源为独立函数、把同一行再解析一遍）；
//  - 新增工具调用展开（`tool_use` / `tool_result` 内容块）：源只判定 kind，CrewStation 的
//    AgentEvent 契约有 `tool` 字段，工作台直接消费。

import type {
  NormalizedEvent,
  NormalizedEventKind,
  NormalizedToolCall,
  NormalizedTokenDelta,
  SystemEventObservation,
} from '../../contract/normalizedEvent';
import { SAFE_RUNTIME_EVENT_TYPE, numOrZero, parseJsonObjectLine } from '../../contract/normalizedEvent';

type Block = Record<string, unknown>;

export function observeSystemEvent(line: string): SystemEventObservation {
  const event = parseJsonObjectLine(line);
  if (event === null) return { runtimeEventType: null, terminalResult: null };
  const rawType = event.type;
  const runtimeEventType = typeof rawType === 'string' && SAFE_RUNTIME_EVENT_TYPE.test(rawType) ? rawType : null;
  return {
    runtimeEventType,
    terminalResult: runtimeEventType === 'result' ? (event.is_error === true ? 'error' : 'success') : null,
  };
}

export function parseEvent(line: string): NormalizedEvent | null {
  const evt = parseJsonObjectLine(line);
  if (evt === null) return null;
  const type = typeof evt.type === 'string' ? evt.type : '';
  const parts = extractContentParts(evt);
  const tool = extractToolCall(parts);
  const sessionId = rootSessionId(evt, type);
  return {
    kind: inferKind(type, parts),
    text: concatText(parts),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(tool === undefined ? {} : { tool }),
    ...(type === 'result' ? { terminalError: { isError: evt.is_error === true, message: typeof evt.result === 'string' ? evt.result : '' } } : {}),
    timestamp: extractTimestamp(evt),
    tokens: extractTokenDelta(type, evt) ?? undefined,
    rawLine: line,
  };
}

/**
 * 根会话身份。Claude 在流帧上重复根会话 id；内联子代理帧用 `parent_tool_use_id` 关联，
 * 不能参与根会话的租约状态机。身份只来自协议书挡（init／result／conversation_reset）
 * 与显式根回合帧（`parent_tool_use_id === null`），不是来自「泛泛地没有子链接字段」。
 */
function rootSessionId(evt: Record<string, unknown>, type: string): string | undefined {
  const isSidechain =
    (evt.parent_tool_use_id !== undefined && evt.parent_tool_use_id !== null) ||
    evt.isSidechain === true ||
    typeof evt.subagent_type === 'string';
  const isExplicitRootTurn =
    (type === 'assistant' || type === 'user' || type === 'stream_event' || type === 'tool_progress') &&
    evt.parent_tool_use_id === null;
  const observesRoot =
    !isSidechain &&
    (isExplicitRootTurn || type === 'result' || type === 'conversation_reset' || (type === 'system' && evt.subtype === 'init'));
  return observesRoot && typeof evt.session_id === 'string' ? evt.session_id : undefined;
}

/** ISO-8601 或数字毫秒的 `timestamp`；缺失／不可解析时 undefined，由泵回退到当前时间。 */
function extractTimestamp(evt: Record<string, unknown>): number | undefined {
  const raw = evt.timestamp;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return undefined;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : undefined;
}

/** 取 `message.content[]`（`{type, text?, thinking?, …}` 数组）。 */
function extractContentParts(evt: Record<string, unknown>): Block[] {
  const msg = evt.message;
  if (!msg || typeof msg !== 'object') return [];
  const content = (msg as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  return content.filter((p): p is Block => !!p && typeof p === 'object');
}

/** 串联一个回合里的可见文本。 */
function concatText(parts: Block[]): string | null {
  const texts: string[] = [];
  for (const p of parts) {
    if (p.type === 'text' && typeof p.text === 'string') texts.push(p.text);
  }
  return texts.length > 0 ? texts.join('') : null;
}

/** 一个回合最多展开一个工具调用；多工具回合取第一个，其余信息仍在 rawLine 里。 */
function extractToolCall(parts: Block[]): NormalizedToolCall | undefined {
  for (const p of parts) {
    if (p.type === 'tool_use' && typeof p.name === 'string') {
      return {
        ...(typeof p.id === 'string' ? { callId: p.id } : {}),
        name: p.name,
        ...(p.input === undefined ? {} : { input: p.input }),
      };
    }
    if (p.type === 'tool_result') {
      return {
        ...(typeof p.tool_use_id === 'string' ? { callId: p.tool_use_id } : {}),
        name: typeof p.tool_use_id === 'string' ? p.tool_use_id : 'tool_result',
        ...(p.content === undefined ? {} : { output: p.content }),
        isError: p.is_error === true,
      };
    }
  }
  return undefined;
}

/** 一个回合归一为一种显示 kind：调了工具算 tool_use，纯思考算 reasoning，否则 text。 */
function inferKind(type: string, parts: Block[]): NormalizedEventKind {
  if (type === 'result') return 'step_finish';
  if (type === 'system') return 'step_start';
  if (type === 'user') return 'tool_result';
  if (parts.some((p) => p.type === 'tool_use')) return 'tool_use';
  if (parts.some((p) => p.type === 'thinking')) return 'reasoning';
  return 'text';
}

/**
 * token 只取累计的 `result.usage`，避免逐回合 `assistant.usage` 重复计数；
 * claude 的 snake_case 键映射为归一后的 delta。
 */
function extractTokenDelta(type: string, evt: Record<string, unknown>): NormalizedTokenDelta | null {
  if (type !== 'result') return null;
  const usage = evt.usage;
  if (!usage || typeof usage !== 'object') return null;
  const u = usage as Record<string, unknown>;
  return {
    input: numOrZero(u.input_tokens),
    output: numOrZero(u.output_tokens),
    cacheRead: numOrZero(u.cache_read_input_tokens),
    cacheCreate: numOrZero(u.cache_creation_input_tokens),
  };
}

/**
 * ← 源 `runtime/claudeCode/driver.ts` 的 `detectSessionNotFound`：
 * `--resume` 的目标不存在时 claude 的 stderr 措辞（源注释称 2026-08-12 本机实测采样）。
 */
const SESSION_NOT_FOUND_PATTERNS: readonly RegExp[] = [
  /no conversation found with session id/i,
  /is not a uuid and does not match any session title/i,
];

export function detectClaudeSessionNotFound(stderrTail: string): boolean {
  if (stderrTail.length === 0) return false;
  return SESSION_NOT_FOUND_PATTERNS.some((re) => re.test(stderrTail));
}
