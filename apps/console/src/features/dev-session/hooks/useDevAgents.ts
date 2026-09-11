import type { StartDevAgentInput } from '@crewstation/api-client';
import type { AgentInstanceDto } from '@crewstation/contracts';
import type { UseMutationResult } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import type { ApiClientError } from '../../../shared/api/useApi';

export interface SendMessageInput {
  readonly agentId: string;
  readonly content: string;
}

export interface DevAgentsHandle {
  readonly agents: readonly AgentInstanceDto[];
  readonly isPending: boolean;
  readonly loadError: ApiClientError | null;
  /** Agent 生命周期事件到达时重读名册：状态字段只在平台侧维护。 */
  readonly refresh: () => void;
  readonly start: UseMutationResult<AgentInstanceDto, ApiClientError, StartDevAgentInput>;
  readonly sendMessage: UseMutationResult<void, ApiClientError, SendMessageInput>;
  readonly cancel: UseMutationResult<void, ApiClientError, string>;
}

/** 开发会话里的并行 Agent：名册与三个动作都走平台 API，输出走流。 */
export function useDevAgents(taskId: string): DevAgentsHandle {
  const key = queryKeys.agents(taskId);
  const query = useApiQuery(key, () => api.devSession.listAgents(taskId));
  const { refetch } = query;
  return {
    agents: query.data?.items ?? [],
    isPending: query.isPending,
    loadError: query.error,
    refresh: useCallback(() => {
      void refetch();
    }, [refetch]),
    start: useApiMutation((input: StartDevAgentInput) => api.devSession.startAgent(taskId, input), { invalidate: [key] }),
    sendMessage: useApiMutation(({ agentId, content }: SendMessageInput) => api.devSession.sendMessage(taskId, agentId, { content })),
    cancel: useApiMutation((agentId: string) => api.devSession.cancelAgent(taskId, agentId), { invalidate: [key] }),
  };
}
