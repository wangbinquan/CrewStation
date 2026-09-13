import { EgressRequestDtoSchema, EgressRequestPageSchema, RequestPageQuerySchema } from '@crewstation/contracts';
import type { EgressRequestDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation } from '../../../shared/api/useApi';
import { useAdminPage } from '../../../shared/admin/useAdminRead';
import { checkRequestPage } from '../../../shared/admin/requestPageState';
import type { RequestPageScope } from '../../../shared/admin/requestPageState';
import { useT } from '../../../shared/lib/useT';

export function useEgressRequestReview(scope: RequestPageScope, active: boolean) {
  const t = useT(), request = { ...scope, limit: 20 };
  const read = useAdminPage(queryKeys.egressRequestPage(request), async () => {
    const parsed = EgressRequestPageSchema.safeParse(await api.egress.listRequestPage(RequestPageQuerySchema.parse(request)));
    if (!parsed.success) throw new Error(t('ui.requestPage.invalid'));
    return checkRequestPage(parsed.data, scope, t('ui.requestPage.invalid'));
  }, active);
  const decide = useApiMutation(async ({ request: original, approve, decision }: { request: EgressRequestDto; approve: boolean; decision: string }) => {
    const parsed = EgressRequestDtoSchema.safeParse(await api.egress.decideRequest(original.id, { approve, decision }));
    if (!parsed.success || parsed.data.id !== original.id || parsed.data.projectId !== original.projectId || parsed.data.fqdn !== original.fqdn ||
      parsed.data.state !== (approve ? 'approved' : 'rejected') || parsed.data.decision !== decision) throw new Error(t('ui.requestPage.invalidDecision'));
    return parsed.data;
  }, { invalidate: [queryKeys.egressRequests(), queryKeys.egressEntries()] });
  return { requests: read.query, decide, busy: read.busy || !read.allowed };
}
