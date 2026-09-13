import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryKey, UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { isApiClientError } from '@crewstation/api-client';
import type { ApiClientError } from '@crewstation/api-client';

export type { ApiClientError };
export { isApiClientError };

/** 读：键 + 取数函数；错误类型固定为 ApiClientError，页面据此区分 403 与 404。 */
export function useApiQuery<T>(key: QueryKey, fetcher: () => Promise<T>, options: { enabled?: boolean; refetchIntervalMs?: number } = {}): UseQueryResult<T, ApiClientError> {
  return useQuery<T, ApiClientError>({ queryKey: key, queryFn: fetcher, enabled: options.enabled ?? true, refetchInterval: options.refetchIntervalMs ?? false, refetchIntervalInBackground: false });
}

/** 写：成功后按前缀失效给定的键。 */
export function useApiMutation<TInput, TResult>(
  mutate: (input: TInput) => Promise<TResult>,
  options: { invalidate?: readonly QueryKey[]; onSuccess?: (result: TResult) => void } = {},
): UseMutationResult<TResult, ApiClientError, TInput> {
  const queryClient = useQueryClient();
  return useMutation<TResult, ApiClientError, TInput>({
    mutationFn: mutate,
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
