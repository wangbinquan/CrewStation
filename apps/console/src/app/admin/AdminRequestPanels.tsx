import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { EgressRequestsSection } from '../../features/admin';
import { CatalogRequestsPage } from '../../features/catalog';
import type { RequestSearch } from '../../shared/admin/managementSearch';
import { keepRequestDrafts } from '../../shared/admin/requestPageState';
import { UnsavedChangesGuard } from '../../shared/navigation/UnsavedChangesGuard';
import { useT } from '../../shared/lib/useT';

/** 同一查询范围下两类表单常驻，页签切换不会丢失输入。 */
export function AdminRequestPanels({ search }: { readonly search: RequestSearch }) {
  const t = useT(), navigate = useNavigate(), [apiDirty, setApiDirty] = useState(false), [egressDirty, setEgressDirty] = useState(false);
  return <>
    <UnsavedChangesGuard dirty={apiDirty || egressDirty} scope={t('ui.requestDraft.scope')} allowNavigate={keepRequestDrafts} />
    <div hidden={search.tab !== 'api'}><CatalogRequestsPage projectId={search.projectId} state={search.state} cursor={search.apiCursor} active={search.tab === 'api'} onDirtyChange={setApiDirty}
      onPage={(apiCursor) => void navigate({ to: '/admin/requests', search: { ...search, apiCursor } })} /></div>
    <div hidden={search.tab !== 'egress'}><p><Link to="/admin/egress">{t('admin.requests.openRules')}</Link></p>
      <EgressRequestsSection projectId={search.projectId} state={search.state} cursor={search.egressCursor} active={search.tab === 'egress'} onDirtyChange={setEgressDirty}
        onPage={(egressCursor) => void navigate({ to: '/admin/requests', search: { ...search, egressCursor } })} /></div>
  </>;
}
