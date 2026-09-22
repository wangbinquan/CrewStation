import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { CatalogRequestsPage } from '../../features/catalog';
import type { RequestSearch } from '../../shared/admin/managementSearch';
import { keepRequestDrafts } from '../../shared/admin/requestPageState';
import { UnsavedChangesGuard } from '../../shared/navigation/UnsavedChangesGuard';
import { useT } from '../../shared/lib/useT';

/** RFC-018 下线出站申请后只剩定向开放一类；未提交的裁定意见仍受离开确认保护。 */
export function AdminRequestPanels({ search }: { readonly search: RequestSearch }) {
  const t = useT(), navigate = useNavigate(), [dirty, setDirty] = useState(false);
  return <>
    <UnsavedChangesGuard dirty={dirty} scope={t('ui.requestDraft.scope')} allowNavigate={keepRequestDrafts} />
    <CatalogRequestsPage projectId={search.projectId} state={search.state} cursor={search.apiCursor} active onDirtyChange={setDirty}
      onPage={(apiCursor) => void navigate({ to: '/admin/requests', search: { ...search, apiCursor } })} />
  </>;
}
