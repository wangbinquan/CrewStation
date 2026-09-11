import type { PreviewStatusResult } from '@crewstation/api-client';
import type { PreviewState, RunnerEvent } from '@crewstation/contracts';

export type PreviewStateEvent = Extract<RunnerEvent, { kind: 'previewState' }>;

export const UNKNOWN_PREVIEW: PreviewStatusResult = { state: 'disabled', restarts: 0 };

/**
 * previewState 事件只带 state／port／message，重启次数只有 previewStatus 结果里有，
 * 所以事件按字段合并进最近一次快照，而不是整体替换。
 */
export function applyPreviewEvent(current: PreviewStatusResult, event: PreviewStateEvent): PreviewStatusResult {
  const port = event.port ?? current.port;
  // crashed 时 message 是崩溃原因，恢复到 ready 则把上次的错误清掉。
  const lastError = event.state === 'ready' ? undefined : (event.message ?? current.lastError);
  return {
    state: event.state,
    restarts: current.restarts,
    ...(port === undefined ? {} : { port }),
    ...(lastError === undefined ? {} : { lastError }),
  };
}

/**
 * 预览地址只在已就绪时给出；开发预览域名由平台在会话上返回，是裸主机名。
 * 用协议相对地址跟随工作台自身的 http／https：本地集群只有 HTTP，写死 https 会得到一个打不开的链接。
 */
export function previewUrl(previewHost: string, state: PreviewState): string | undefined {
  if (previewHost.length === 0 || state !== 'ready') return undefined;
  return `//${previewHost.replace(/^https?:\/\//i, '')}`;
}
