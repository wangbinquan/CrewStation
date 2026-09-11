import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './apiError';

/** React Query 客户端：4xx 不重试（权限与校验错误重试无意义），5xx 与网络错误最多重试 2 次。 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => failureCount < 2 && !(isApiError(error) && error.status < 500),
      },
    },
  });
}
