export type DevelopmentView = 'cli' | 'preview' | 'split' | 'code' | 'diff' | 'changes' | 'conversation' | 'data' | 'reference' | 'session';
/** 参考面板的三段（原开发资源的 API 接口、事件、平台接入，RFC-020 D2）。 */
export const REFERENCE_TOPICS = ['api', 'events', 'guide'] as const;
export type ReferenceTopic = typeof REFERENCE_TOPICS[number];
export const GUIDE_SECTIONS = ['identity', 'environment', 'mcp', 'tasks'] as const;
export type GuideSection = typeof GUIDE_SECTIONS[number];
export interface DevelopmentSearch {
  view?: DevelopmentView; file?: string; target?: 'prod' | 'preview'; task?: string; agent?: string; terminal?: string; turn?: string; event?: string; focus?: string; seq?: number;
  /** 工具面板形态：在终端旁边（缺省）或放大到整个内容区。 */
  panel?: 'side' | 'full';
  /** 参考面板的当前段与它保留的定位参数。 */
  topic?: ReferenceTopic; proxy?: string; operation?: string; subscription?: string;
  /** 平台接入段里默认展开的小节（原 resources?section=guide&topic=…）。 */
  guide?: GuideSection;
}

const VIEWS: readonly DevelopmentView[] = ['cli', 'preview', 'split', 'code', 'diff', 'changes', 'conversation', 'data', 'reference', 'session'];
const text = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value) ? value : undefined;

/** 两空间共用活动定位协议；历史对话仍由各自路由接续。 */
export function parseDevelopmentSearch(search: Record<string, unknown>): DevelopmentSearch {
  const view = typeof search.view === 'string' && VIEWS.includes(search.view as DevelopmentView) ? search.view as DevelopmentView : undefined;
  const file = typeof search.file === 'string' && search.file.length > 0 && search.file.length <= 4096 && !/[\u0000-\u001f]/u.test(search.file) ? search.file : undefined;
  const topic = REFERENCE_TOPICS.find((value) => value === search.topic), guide = GUIDE_SECTIONS.find((value) => value === search.guide);
  return {
    ...Object.fromEntries(['task', 'agent', 'terminal', 'turn', 'event', 'focus'].filter((key) => typeof search[key] === 'string' && String(search[key]).length <= 256).map((key) => [key, search[key]])),
    ...(view ? { view } : {}), ...(file ? { file } : {}), ...(search.target === 'preview' || search.target === 'prod' ? { target: search.target } : {}),
    ...(Number.isSafeInteger(Number(search.seq)) && Number(search.seq) >= 0 ? { seq: Number(search.seq) } : {}),
    ...(search.panel === 'side' || search.panel === 'full' ? { panel: search.panel } : {}),
    ...(topic ? { topic } : {}), ...(guide ? { guide } : {}),
    ...(text(search.proxy, 80) ? { proxy: text(search.proxy, 80) } : {}), ...(text(search.operation, 2048) ? { operation: text(search.operation, 2048) } : {}),
    ...(text(search.subscription, 256) ? { subscription: text(search.subscription, 256) } : {}),
  };
}
export function parseConversationSearch(search: Record<string, unknown>): { agent?: string } {
  return { ...(typeof search.agent === 'string' && search.agent.length <= 256 ? { agent: search.agent } : {}) };
}
