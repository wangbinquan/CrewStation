import type { AppAccessRequestDto, RequestPageQuery } from '@crewstation/contracts';
import { AppAccessRequestDtoSchema, AppAccessRequestPageSchema, RequestPageQuerySchema } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';

export interface AccessRequestScope {
  readonly projectId?: string;
  readonly state: RequestPageQuery['state'];
  readonly cursor?: string;
}

/**
 * 应用使用申请的清单与审批（2026-09-24 裁定）：项目内（应用展示页、概览提醒）只读待处理的，管理空间按状态分页读全部。
 * 每 30 秒静默重读，不给刷新按钮；审批后按前缀一次失效，连带重读成员（批准即加为「用户」）。
 */
export function useAccessRequestReview(scope: AccessRequestScope, enabled = true) {
  const t = useT(), query = { ...scope, limit: 20 };
  const requests = useApiQuery(queryKeys.appAccessRequests(query), async () => {
    const parsed = AppAccessRequestPageSchema.safeParse(await api.projects.listAppAccessRequests(RequestPageQuerySchema.parse(query)));
    if (!parsed.success || (scope.projectId && parsed.data.items.some((item) => item.projectId !== scope.projectId))) throw new Error(t('ui.requestPage.invalid'));
    return parsed.data;
  }, { enabled, refetchIntervalMs: 30_000, refetchOnWindowFocus: true });
  const decide = useApiMutation(async ({ request, approve, decision }: { request: AppAccessRequestDto; approve: boolean; decision?: string }) => {
    const parsed = AppAccessRequestDtoSchema.safeParse(await api.projects.decideAppAccessRequest(request.id, { approve, ...(decision ? { decision } : {}) }));
    if (!parsed.success || parsed.data.id !== request.id || parsed.data.state !== (approve ? 'approved' : 'rejected')) throw new Error(t('ui.requestPage.invalidDecision'));
    return parsed.data;
  }, { invalidate: [queryKeys.appAccessRequests(), queryKeys.projects()] });
  return { requests, decide };
}
