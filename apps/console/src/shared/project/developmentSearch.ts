export interface DevelopmentSearch { view?: string; task?: string; agent?: string; terminal?: string; turn?: string; event?: string; focus?: string; seq?: number }

/** 两空间共用活动定位协议；历史对话仍由各自路由接续。 */
export function parseDevelopmentSearch(search: Record<string, unknown>): DevelopmentSearch {
  return {
    ...Object.fromEntries(['view', 'task', 'agent', 'terminal', 'turn', 'event', 'focus'].filter((key) => typeof search[key] === 'string' && String(search[key]).length <= 256).map((key) => [key, search[key]])),
    ...(Number.isSafeInteger(Number(search.seq)) && Number(search.seq) >= 0 ? { seq: Number(search.seq) } : {}),
  };
}
export function parseConversationSearch(search: Record<string, unknown>): { agent?: string } {
  return { ...(typeof search.agent === 'string' && search.agent.length <= 256 ? { agent: search.agent } : {}) };
}
