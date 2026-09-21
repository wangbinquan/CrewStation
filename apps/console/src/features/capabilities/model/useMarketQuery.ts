import { useQuery } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';

/**
 * 用户切换不复用缓存；离开即回收，回页／聚焦现查。
 * 例行刷新在途时保留当前卡片、数据到达后原地替换：清空会让整片网格塌掉、滚动回到顶部
 * （2026-09-21 实机，作者当面裁定）。读取失败或撤权仍立即撤下旧授权投影。
 */
export function useMarketQuery<T>(key: QueryKey, fetcher: () => Promise<T>) {
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const query = useQuery({ queryKey: ['market', me.data?.id, ...key], queryFn: fetcher,
    enabled: Boolean(me.data) && !me.error, gcTime: 0, staleTime: 0, retry: false,
    refetchOnMount: 'always', refetchOnWindowFocus: 'always', refetchInterval: 15_000, refetchIntervalInBackground: false,
  });
  return { ...query, isPending: me.isPending || query.isPending, error: me.error ?? query.error,
    current: me.data && !me.error && !query.error ? query.data : undefined,
  };
}
