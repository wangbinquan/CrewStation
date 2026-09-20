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
  }, active);
  const decide = useApiMutation(async ({ request: original, approve, decision }: { request: ApiRequestDto; approve: boolean; decision?: string }) => {
    const parsed = ApiRequestDtoSchema.safeParse(await api.apiCatalog.decideRequest(original.id, { approve, decision }));
    if (!parsed.success || parsed.data.id !== original.id || parsed.data.serviceId !== original.serviceId || parsed.data.operationId !== original.operationId ||
      parsed.data.state !== (approve ? 'approved' : 'rejected') || parsed.data.decision !== decision) throw new Error(t('ui.requestPage.invalidDecision'));
    return parsed.data;
  }, { invalidate: [queryKeys.operations(), queryKeys.accessRequests()] });
  return { requests: read.query, decide, busy: read.busy || !read.allowed };
}
