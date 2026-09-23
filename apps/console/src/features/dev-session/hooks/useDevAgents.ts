import type { AgentInstanceDto, StartDevAgentRequest } from '@crewstation/contracts';
import type { UseMutationResult } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
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
  readonly start: UseMutationResult<AgentInstanceDto, ApiClientError, StartDevAgentRequest>;
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
    start: useApiMutation((input: StartDevAgentRequest) => api.devSession.startAgent(taskId, input), { invalidate: [key] }),
    sendMessage: useApiMutation(({ agentId, content }: SendMessageInput) => api.devSession.sendMessage(taskId, agentId, { content })),
    cancel: useApiMutation((agentId: string) => api.devSession.cancelAgent(taskId, agentId), { invalidate: [key] }),
  };
}

export interface AgentSelection {
  /** 用户选过的对象；没选过时是链接里的 agent（可能不存在）。 */
  readonly picked: string | undefined;
  readonly selected: AgentInstanceDto | undefined;
  readonly select: (agentId: string) => void;
}

/**
 * 当前选中的 Agent：面板据此显示转录与输入，页面据此决定订阅哪条执行环境的流（RFC-006）。
 * 链接里的 agent 变了就以链接为准；没选过也没有链接时看第一个——名册异步到达时不需要在 effect 里补 setState。
 */
export function useAgentSelection(agents: readonly AgentInstanceDto[], initialAgentId: string | undefined): AgentSelection {
  const [choice, setChoice] = useState<{ source?: string; agentId?: string }>({});
  const picked = choice.source === initialAgentId ? choice.agentId : initialAgentId;
  const select = useCallback((agentId: string) => setChoice({ source: initialAgentId, agentId }), [initialAgentId]);
  const selected = picked === undefined ? agents[0] : agents.find((agent) => agent.agentId === picked);
  return { picked, selected, select };
}
