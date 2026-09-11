/**
 * 以本服务身份调用平台 API，运行一次 Agent 子任务（业务子任务契约层，Design §10）。
 * 请求不带任何凭据：它经服务域到达网关，网关按源 Pod IP 识别调用方服务并注入来源令牌。
 * 路径与请求／响应形状对应 packages/contracts/api/businessTask.ts；`x-cs-trace-id` 按约定表转发。
 */
import { IDENTITY_HEADERS } from './identity';

/** 必须与 crewstation.yaml `spec.tasks.agentProfiles[].name` 一致：Agent 子任务只能引用发布时登记的档案。 */
export const CHAT_AGENT_PROFILE = 'chat-v1';
export const CHAT_SUBTASK_NAME = 'chat';

export const TERMINAL_STATES = ['succeeded', 'failed', 'cancelled'] as const;
export type TerminalState = (typeof TERMINAL_STATES)[number];

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AgentClientOptions {
  /** `CS_PLATFORM_API_URL`，不含末尾斜杠。 */
  baseUrl: string;
  /** 页面请求带来的 `x-cs-trace-id`；转发它，本次业务任务就串进同一条链路。 */
  traceId?: string | null;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** 轮询子任务状态的间隔，默认 1 秒。 */
  pollIntervalMs?: number;
  /** 等待子任务结束的上限，默认 2 分钟；超时按失败处理并关闭任务。 */
  timeoutMs?: number;
}

export interface ChatRunResult {
  taskId: string;
  subtaskId: string;
  state: TerminalState;
  /** 子任务输出（`text/plain`）；失败或取消时也可能有部分内容。 */
  text: string;
  /** 平台记录的子任务错误说明。 */
  error: string | null;
}

/** 平台 API 的某一步失败；message 已是可直接展示的中文说明。 */
export class PlatformApiError extends Error {
  constructor(readonly step: string, message: string, readonly status?: number) {
    super(message);
    this.name = 'PlatformApiError';
  }
}

/**
 * 创建业务任务 → 提交 oneshot Agent 子任务 → 每秒轮询到终态 → 读取输出 → 关闭任务。
 * 终态为 failed／cancelled 时不抛错，由调用方决定如何展示；平台调用本身失败才抛 PlatformApiError。
 */
export async function runChat(prompt: string, options: AgentClientOptions): Promise<ChatRunResult> {
  const http = createTransport(options);
  const taskId = requireId('创建业务任务', await http.post('创建业务任务', '/v1/business-tasks', {}));
  const taskPath = `/v1/business-tasks/${encodeURIComponent(taskId)}`;
  try {
    const subtaskId = requireId('提交 Agent 子任务', await http.post('提交 Agent 子任务', `${taskPath}/subtasks`, {
      kind: 'agent',
      name: CHAT_SUBTASK_NAME,
      agentProfile: CHAT_AGENT_PROFILE,
      mode: 'oneshot',
      prompt,
    }));
    const subtaskPath = `${taskPath}/subtasks/${encodeURIComponent(subtaskId)}`;
    const finished = await waitForTerminalState(http, subtaskPath, options);
    const text = await http.getText('读取子任务输出', `${subtaskPath}/output`);
    return { taskId, subtaskId, state: finished.state, text, error: finished.error };
  } finally {
    // 成败都关闭任务以释放任务容器；关闭本身失败不掩盖前面的错误。
    await http.post('关闭业务任务', `${taskPath}/close`).catch(() => undefined);
  }
}

interface Transport {
  post(step: string, path: string, body?: unknown): Promise<unknown>;
  get(step: string, path: string): Promise<unknown>;
  getText(step: string, path: string): Promise<string>;
}

function createTransport(options: AgentClientOptions): Transport {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const send = async (step: string, path: string, init: RequestInit, accept: string): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set('accept', accept);
    if (options.traceId) headers.set(IDENTITY_HEADERS.traceId, options.traceId);
    let response: Response;
    try {
      response = await doFetch(`${options.baseUrl}${path}`, { ...init, headers });
    } catch (err) {
      throw new PlatformApiError(step, `${step}失败：无法连接平台 API（${describeError(err)}）`);
    }
    if (!response.ok) {
      throw new PlatformApiError(step, `${step}失败：HTTP ${response.status}${await describeErrorBody(response)}`, response.status);
    }
    return response;
  };
  return {
    post: async (step, path, body) => parseJsonBody(step, await send(step, path, {
      method: 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, 'application/json')),
    get: async (step, path) => parseJsonBody(step, await send(step, path, { method: 'GET' }, 'application/json')),
    getText: async (step, path) => (await send(step, path, { method: 'GET' }, 'text/plain')).text(),
  };
}

async function waitForTerminalState(
  http: Transport,
  subtaskPath: string,
  options: AgentClientOptions,
): Promise<{ state: TerminalState; error: string | null }> {
  const step = '查询子任务状态';
  const interval = options.pollIntervalMs ?? 1000;
  const maxPolls = Math.max(1, Math.ceil((options.timeoutMs ?? 120_000) / interval));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastState = 'unknown';
  for (let poll = 1; poll <= maxPolls; poll++) {
    const dto = await http.get(step, subtaskPath);
    const state = isRecord(dto) && typeof dto.state === 'string' ? dto.state : null;
    if (!state) throw new PlatformApiError(step, `${step}失败：响应缺少 state`);
    lastState = state;
    if (isTerminal(state)) return { state, error: isRecord(dto) && typeof dto.error === 'string' ? dto.error : null };
    if (poll < maxPolls) await sleep(interval);
  }
  throw new PlatformApiError(step, `等待子任务结束超时（约 ${Math.round((maxPolls * interval) / 1000)} 秒，最后状态 ${lastState}）`);
}

function isTerminal(state: string): state is TerminalState {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

function requireId(step: string, value: unknown): string {
  if (isRecord(value) && typeof value.id === 'string' && value.id.length > 0) return value.id;
  throw new PlatformApiError(step, `${step}失败：响应缺少 id`);
}

async function parseJsonBody(step: string, response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PlatformApiError(step, `${step}失败：响应不是合法 JSON`);
  }
}

/** 平台错误信封为 `{ error, message, details }`；能解析就取 message，否则截取原文。 */
async function describeErrorBody(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return '';
  try {
    const envelope: unknown = JSON.parse(text);
    if (isRecord(envelope) && typeof envelope.message === 'string') {
      const code = typeof envelope.error === 'string' ? `${envelope.error}：` : '';
      return `（${code}${envelope.message}）`;
    }
  } catch {
    // 非 JSON 错误体，下面原样截取。
  }
  return `（${text.slice(0, 200)}）`;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
