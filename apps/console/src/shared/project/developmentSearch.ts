export type DevelopmentView = 'cli' | 'preview' | 'split' | 'code' | 'diff' | 'changes' | 'conversation' | 'data' | 'session';
export interface DevelopmentSearch { view?: DevelopmentView; file?: string; target?: 'prod' | 'preview'; task?: string; agent?: string; terminal?: string; turn?: string; event?: string; focus?: string; seq?: number }

/** 两空间共用活动定位协议；历史对话仍由各自路由接续。 */
export function parseDevelopmentSearch(search: Record<string, unknown>): DevelopmentSearch {
  const view = typeof search.view === 'string' && ['cli', 'preview', 'split', 'code', 'diff', 'changes', 'conversation', 'data', 'session'].includes(search.view) ? search.view as DevelopmentView : undefined;
  const file = typeof search.file === 'string' && search.file.length > 0 && search.file.length <= 4096 && !/[\u0000-\u001f]/u.test(search.file) ? search.file : undefined;
  return {
    ...Object.fromEntries(['task', 'agent', 'terminal', 'turn', 'event', 'focus'].filter((key) => typeof search[key] === 'string' && String(search[key]).length <= 256).map((key) => [key, search[key]])),
    ...(view ? { view } : {}), ...(file ? { file } : {}), ...(search.target === 'preview' || search.target === 'prod' ? { target: search.target } : {}),
    ...(Number.isSafeInteger(Number(search.seq)) && Number(search.seq) >= 0 ? { seq: Number(search.seq) } : {}),
  };
}
export function parseConversationSearch(search: Record<string, unknown>): { agent?: string } {
  return { ...(typeof search.agent === 'string' && search.agent.length <= 256 ? { agent: search.agent } : {}) };
}
