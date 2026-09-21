import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryKey, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import { ApiClientError, isApiClientError } from '@crewstation/api-client';
import { useT } from '../lib/useT';

export type { ApiClientError };
export { isApiClientError };

/**
 * 读：键 + 取数函数；错误类型固定为 ApiClientError，页面据此区分 403 与 404。
 *
 * `keepPrevious`：只换读取目标而筛选没变时（例如后台每 30 秒换一份集群快照，快照 id 进了查询键），
 * 由它判断旧键是否仍可用；可用就先留住上一份数据，等新回执到达再原地替换。没有它，新键会先给出
 * 「载入中」，内容整块卸载后滚动容器塌掉，滚动位置回到顶部（2026-09-21 实机）。
 */
export function useApiQuery<T>(key: QueryKey, fetcher: () => Promise<T>, options: { enabled?: boolean; refetchIntervalMs?: number; staleTimeMs?: number; refetchOnWindowFocus?: boolean; keepPrevious?: (previousKey: QueryKey) => boolean } = {}): UseQueryResult<T, ApiClientError> {
  const { keepPrevious } = options;
  return useQuery<T, ApiClientError>({ queryKey: key, queryFn: fetcher, enabled: options.enabled ?? true, refetchInterval: options.refetchIntervalMs ?? false, refetchIntervalInBackground: false,
    ...(options.staleTimeMs === undefined ? {} : { staleTime: options.staleTimeMs }),
    ...(options.refetchOnWindowFocus === undefined ? {} : { refetchOnWindowFocus: options.refetchOnWindowFocus }),
    // 断言：库把 placeholderData 的数据类型收成 NonFunctionGuard<T>，泛型读取在此处无法自证，值本身仍是上一次的回执。
    ...(keepPrevious === undefined ? {} : { placeholderData: ((previous: T | undefined, previousQuery?: { queryKey: QueryKey }) => previousQuery && keepPrevious(previousQuery.queryKey) ? previous : undefined) as UseQueryOptions<T, ApiClientError, T, QueryKey>['placeholderData'] }) });
}

/** 写：成功后按前缀失效给定的键。 */
export function useApiMutation<TInput, TResult>(
  mutate: (input: TInput) => Promise<TResult>,
  options: { invalidate?: readonly QueryKey[]; onSuccess?: (result: TResult) => void } = {},
): UseMutationResult<TResult, ApiClientError, TInput> {
  const queryClient = useQueryClient();
  const t = useT();
  return useMutation<TResult, ApiClientError, TInput>({
    // 离线点击不加入恢复队列；已发出的请求仍保留其真实回执，失败不自动重发。
    networkMode: 'always',
    retry: 0,
    mutationFn: (input) => {
      if (!onlineManager.isOnline()) throw new ApiClientError(0, { error: 'unavailable', message: t('ui.connection.notSent'), details: { reason: 'offline', requestSent: false } });
      return mutate(input);
    },
    onSuccess: async (result) => {
      for (const key of options.invalidate ?? []) await queryClient.invalidateQueries({ queryKey: key });
      options.onSuccess?.(result);
    },
  });
}

/** 把错误渲染成一行文案：优先服务端 message，其次状态码。 */
export function errorMessage(error: unknown): string {
  if (isApiClientError(error)) return error.message;
  return error instanceof Error ? error.message : String(error);
}
