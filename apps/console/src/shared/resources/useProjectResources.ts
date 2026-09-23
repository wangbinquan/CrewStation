// RFC-025 设计 §10：页面读项目资源状态的唯一入口——先读快照，再开推送流；同一项目的所有页面共用一条连接与同一份缓存。
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ResourceView } from '@crewstation/contracts';
import { api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import type { ApiClientError } from '../api/useApi';
import { useApiQuery } from '../api/useApi';
import type { ProjectResourceSource } from './projectResourceStreams';
import { retainProjectResources } from './projectResourceStreams';

/** 运行时才看有没有 EventSource：用例与不支持的环境只用快照（推送流不开，快照也不轮询）。 */
function browserSource(): ProjectResourceSource {
  const EventSourceImpl = (globalThis as { EventSource?: new (url: string) => EventSource }).EventSource;
  return {
    view: (projectId) => api.resources.view(projectId),
    streamUrl: (projectId, cursor) => api.resources.streamUrl(projectId, { cursor }),
    ...(EventSourceImpl ? { open: (url: string) => new EventSourceImpl(url) } : {}),
  };
}

/**
 * 项目的标准资源记录（在运行、结束中与失败保留中的；推送流带来的「已结束」也留在缓存里，供页面知道它结束了）。
 * 快照永不过期（推送流让它保持最新），不按窗口焦点重读；读失败按常规错误显示，恢复后从新游标重新开流。
 */
export function useProjectResources(projectId: string, options: { readonly enabled?: boolean } = {}): UseQueryResult<ResourceView, ApiClientError> {
  const enabled = (options.enabled ?? true) && projectId !== '';
  const client = useQueryClient();
  const query = useApiQuery(queryKeys.projectResources(projectId), () => api.resources.view(projectId), { enabled, staleTimeMs: Number.POSITIVE_INFINITY, refetchOnWindowFocus: false });
  const live = enabled && query.status === 'success';
  useEffect(() => (live ? retainProjectResources(client, projectId, browserSource()) : undefined), [client, projectId, live]);
  return query;
}
