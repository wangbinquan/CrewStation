import type { PublishInput } from '@crewstation/api-client';
import type { ReleaseDto } from '@crewstation/contracts';
import type { UseMutationResult } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation } from '../../../shared/api/useApi';
import type { ApiClientError } from '../../../shared/api/useApi';
import { uncommittedPaths } from '../model/publishFailure';
import { useBranches } from './useBranches';
import type { BranchesHandle } from './useBranches';

export interface PublishHandle extends BranchesHandle {
  readonly publish: UseMutationResult<ReleaseDto, ApiClientError, PublishInput>;
  /** 412 预检失败时容器里未提交的路径；非空即渲染清单而不是一行错误。 */
  readonly uncommitted: readonly string[];
}

/** 从会话发起发布：只有平台打的 v 标签会触发构建，手工标签不会。 */
export function usePublishForm(projectId: string): PublishHandle {
  const branches = useBranches(projectId);
  const publish = useApiMutation((input: PublishInput) => api.devSession.publish(projectId, input), {
    invalidate: [queryKeys.branches(projectId), queryKeys.devSession(projectId)],
  });
  return { ...branches, publish, uncommitted: uncommittedPaths(publish.error) };
}
