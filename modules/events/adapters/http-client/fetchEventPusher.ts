import type { EventPusher } from '../../ports/eventPusher';

/** 经服务域 POST 信封：来源令牌由网关注入，这里只带事件头。非 2xx、超时与网络错误都算失败，交给投递状态机退避重试。 */
export function fetchEventPusher(options: { timeoutMs: number }): EventPusher {
  return {
    push: async (url, body, headers) => {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(options.timeoutMs),
        });
        await response.arrayBuffer().catch(() => undefined);
        return response.ok ? { ok: true, status: response.status } : { ok: false, status: response.status, error: `HTTP ${response.status}` };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
