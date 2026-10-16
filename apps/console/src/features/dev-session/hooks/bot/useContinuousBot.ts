import { useCallback, useRef, useState } from 'react';
import type { BotExecutionDto, BotHistoryDto, SendBotMessageRequest } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { errorMessage, useApiMutation, useApiQuery } from '../../../../shared/api/useApi';

export function useContinuousBot(taskId: string) {
  const key = ['continuous-bot', taskId], historyKey = ['continuous-bot-history', taskId];
  const query = useApiQuery(key, () => api.devSession.getBot(taskId), { refetchIntervalMs: 2_000 });
  const history = useApiQuery(historyKey, () => api.devSession.botHistory(taskId), { refetchIntervalMs: 5_000 });
  const [older, setOlder] = useState<{ items: BotExecutionDto[]; next?: string }>();
  const [loadingMore, setLoadingMore] = useState(false), [historyError, setHistoryError] = useState<string>();
  const moreBusy = useRef(false), invalidate = [key, historyKey];
  const executions = [...new Map([...(older?.items ?? []), ...(history.data?.items ?? []), ...(query.data?.conversation?.execution ? [query.data.conversation.execution] : [])].map(item => [item.agentId, item])).values()].sort((a, b) => a.agentId.localeCompare(b.agentId));
  const next = older ? older.next : history.data?.next;
  const more = async () => {
    if (!next || moreBusy.current) return;
    moreBusy.current = true; setLoadingMore(true); setHistoryError(undefined);
    try { const page: BotHistoryDto = await api.devSession.botHistory(taskId, { after: next }); setOlder(previous => ({ items: [...previous?.items ?? [], ...page.items], next: page.next })); }
    catch (error) { setHistoryError(errorMessage(error)); }
    finally { moreBusy.current = false; setLoadingMore(false); }
  };
  const { refetch } = query;
  return { conversation: query.data?.conversation, pending: query.isPending, error: query.error,
    executions, more, hasMore: !!next, loadingMore, historyError: historyError ?? (history.error ? errorMessage(history.error) : undefined),
    refresh: useCallback(() => { void refetch(); }, [refetch]),
    send: useApiMutation((input: SendBotMessageRequest) => api.devSession.sendBotMessage(taskId, input), { invalidate }),
    interrupt: useApiMutation(() => api.devSession.interruptBot(taskId, { requestId: crypto.randomUUID(), expectedRevision: query.data!.conversation!.revision, expectedExecutionId: query.data!.conversation!.execution!.executionTaskId }), { invalidate }),
    fresh: useApiMutation(() => api.devSession.freshBotContext(taskId, { requestId: crypto.randomUUID(), expectedRevision: query.data!.conversation!.revision, fresh: true }), { invalidate }),
  };
}
export type ContinuousBotHandle = ReturnType<typeof useContinuousBot>;
