import { ApiRequestDtoSchema, ApiRequestPageSchema, RequestPageQuerySchema } from '@crewstation/contracts';
import type { ApiRequestDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation } from '../../../shared/api/useApi';
import { useAdminPage } from '../../../shared/admin/useAdminRead';
import { checkRequestPage } from '../../../shared/admin/requestPageState';
import type { RequestPageScope } from '../../../shared/admin/requestPageState';
import { useT } from '../../../shared/lib/useT';

export function useCatalogRequestReview(scope: RequestPageScope, active: boolean) {
  const t = useT(), request = { ...scope, limit: 20 };
  const read = useAdminPage(queryKeys.accessRequestPage(request), async () => {
    const parsed = ApiRequestPageSchema.safeParse(await api.apiCatalog.listRequestPage(RequestPageQuerySchema.parse(request)));
    if (!parsed.success) throw new Error(t('ui.requestPage.invalid'));
    return checkRequestPage(parsed.data, scope, t('ui.requestPage.invalid'));
  }, active, true);
  const decide = useApiMutation(async ({ request: original, approve, decision }: { request: ApiRequestDto; approve: boolean; decision?: string }) => {
    const parsed = ApiRequestDtoSchema.safeParse(await api.apiCatalog.decideRequest(original.id, { approve, decision }));
    if (!parsed.success || parsed.data.id !== original.id || parsed.data.serviceId !== original.serviceId || parsed.data.operationId !== original.operationId ||
      parsed.data.state !== (approve ? 'approved' : 'rejected') || parsed.data.decision !== decision) throw new Error(t('ui.requestPage.invalidDecision'));
    return parsed.data;
  }, { invalidate: [queryKeys.operations(), queryKeys.accessRequests()] });
  // 申请每 30 秒静默重读，不提供「刷新 API 申请」（2026-09-23 裁定）；例行重读不暂停裁定。裁定之后的重读由 decide 的
  // invalidate 在 onSuccess 里完成，期间 decide.isPending 仍为真，页面照旧暂停。
  return { requests: read.query, decide, busy: read.loading || !read.allowed };
}
