import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryKey, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import { ApiClientError, isApiClientError } from '@crewstation/api-client';
import { useT } from '../lib/useT';

export type { ApiClientError };
export { isApiClientError };

/**
 * 页面数据自动重读（2026-09-23 作者裁定：页面元素自动局部刷新，不提供刷新按钮）：每 30 秒在原位重读，回到前台补读一次。
 * 例行重读是静默的——不要拿 `isFetching` 禁用按钮或显示「载入中」，否则入口每 30 秒闪一次。
 */
export const AUTO_REFRESH = { refetchIntervalMs: 30_000, refetchOnWindowFocus: true } as const;

/** 读取失败后多久自动再读：网络中断与 5xx 会自己恢复；4xx（权限、校验、不存在、冲突）不会，不重试。 */
export const FAILED_READ_RETRY_MS = 15_000;

export function retryableReadError(error: unknown): boolean {
  return !(isApiClientError(error) && error.status >= 400 && error.status < 500);
}

/**
 * 读：键 + 取数函数；错误类型固定为 ApiClientError，页面据此区分 403 与 404。
 *
 * `keepPrevious`：只换读取目标而筛选没变时（例如后台每 30 秒换一份集群快照，快照 id 进了查询键），
 * 由它判断旧键是否仍可用；可用就先留住上一份数据，等新回执到达再原地替换。没有它，新键会先给出
 * 「载入中」，内容整块卸载后滚动容器塌掉，滚动位置回到顶部（2026-09-21 实机）。
 *
 * refetchIntervalMs 也可以按最近一次的数据决定（例如有对象在启动时每秒一次，RFC-022）；读取失败时另按 FAILED_READ_RETRY_MS 自动重试。
 *
 * 定时重读的查询在后台暂停、回到前台补读（与 `usePollingRefetch` 同一规则）：数据旧过一个重读周期就算过期（只缩短
 * QueryClient 缺省的新鲜期，不延长），进入页面或切回标签页时立即重读。否则全局 30 秒的新鲜期会挡掉补读，后台期间跳过的
 * 那次重读也补不回来（2026-09-23 形态图实机：15 秒重读的页面切走 18 秒再切回，又等了 10 秒才重读）。
 * 显式给的 staleTimeMs、refetchOnWindowFocus 优先。
 */
export function useApiQuery<T>(key: QueryKey, fetcher: () => Promise<T>, options: { enabled?: boolean; refetchIntervalMs?: number | ((data: T | undefined) => number | undefined); staleTimeMs?: number; refetchOnWindowFocus?: boolean; keepPrevious?: (previousKey: QueryKey) => boolean } = {}): UseQueryResult<T, ApiClientError> {
  const { keepPrevious, refetchIntervalMs } = options;
  const refetchInterval = (query: { state: { data: T | undefined; status: string; error: ApiClientError | null } }) => {
    const configured = typeof refetchIntervalMs === 'function' ? refetchIntervalMs(query.state.data) : refetchIntervalMs;
    if (query.state.status === 'error' && retryableReadError(query.state.error)) return Math.min(configured ?? FAILED_READ_RETRY_MS, FAILED_READ_RETRY_MS);
    return configured ?? false;
  };
  const pollMs = (query: { state: { data: T | undefined } }) => { const ms = typeof refetchIntervalMs === 'function' ? refetchIntervalMs(query.state.data) : refetchIntervalMs; return ms !== undefined && ms > 0 ? ms : undefined; };
  // 未设时按 React Query 自己的缺省（新鲜期 0、切回重读）；工作台的 createQueryClient 是 30 秒、切回不重读。
  const base = useQueryClient().getDefaultOptions().queries, baseStale = base?.staleTime ?? 0, baseFocus = base?.refetchOnWindowFocus ?? true;
  const polled = refetchIntervalMs !== undefined;
  const staleTime = options.staleTimeMs ?? (polled && typeof baseStale === 'number' ? (query: { state: { data: T | undefined } }) => Math.min(pollMs(query) ?? baseStale, baseStale) : undefined);
  const refetchOnWindowFocus = options.refetchOnWindowFocus ?? (polled && typeof baseFocus === 'boolean' ? (query: { state: { data: T | undefined } }) => pollMs(query) !== undefined || baseFocus : undefined);
  return useQuery<T, ApiClientError>({ queryKey: key, queryFn: fetcher, enabled: options.enabled ?? true, refetchInterval, refetchIntervalInBackground: false,
    ...(staleTime === undefined ? {} : { staleTime }),
    ...(refetchOnWindowFocus === undefined ? {} : { refetchOnWindowFocus }),
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
