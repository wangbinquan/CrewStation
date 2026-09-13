import { useQuery } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';

/** 用户切换不复用缓存；离开即回收，回页／聚焦现查，刷新期间不展示旧授权投影。 */
export function useMarketQuery<T>(key: QueryKey, fetcher: () => Promise<T>) {
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const query = useQuery({ queryKey: ['market', me.data?.id, ...key], queryFn: fetcher,
    enabled: Boolean(me.data) && !me.error, gcTime: 0, staleTime: 0, retry: false,
    refetchOnMount: 'always', refetchOnWindowFocus: 'always', refetchInterval: 15_000, refetchIntervalInBackground: false,
  });
  return { ...query, isPending: me.isPending || query.isPending, error: me.error ?? query.error,
    current: me.data && !me.error && !query.isFetching && !query.error ? query.data : undefined,
  };
}
