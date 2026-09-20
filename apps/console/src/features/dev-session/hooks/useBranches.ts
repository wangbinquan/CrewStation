import type { BranchDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import type { ApiClientError } from '../../../shared/api/useApi';

export interface BranchesHandle {
  readonly branches: readonly BranchDto[];
  readonly isPending: boolean;
  readonly loadError: ApiClientError | null;
  readonly refresh?: () => Promise<unknown>;
}

/** 分支列表带各分支落后两槽的提交数：开会话与发布都从这里选分支。 */
export function useBranches(projectId: string): BranchesHandle {
  const query = useApiQuery(queryKeys.branches(projectId), () => api.devSession.listBranches(projectId));
  return { branches: query.data?.items ?? [], isPending: query.isPending, loadError: query.error, refresh: query.refetch };
}
