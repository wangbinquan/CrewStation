import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { CatalogRequestsPage } from '../../features/catalog';
import { AccessRequestReview } from '../../features/projects';
import type { RequestSearch } from '../../shared/admin/managementSearch';
import { keepRequestDrafts } from '../../shared/admin/requestPageState';
import { UnsavedChangesGuard } from '../../shared/navigation/UnsavedChangesGuard';
import { useT } from '../../shared/lib/useT';
import { Stack } from '../../shared/ui/Stack';

/** API 定向开放申请与应用使用申请（2026-09-24）两类，各自分页；未提交的裁定意见仍受离开确认保护。 */
export function AdminRequestPanels({ search }: { readonly search: RequestSearch }) {
  const t = useT(), navigate = useNavigate(), [dirty, setDirty] = useState(false);
  return <Stack>
    <UnsavedChangesGuard dirty={dirty} scope={t('ui.requestDraft.scope')} allowNavigate={keepRequestDrafts} />
    <div><CatalogRequestsPage projectId={search.projectId} state={search.state} cursor={search.apiCursor} active onDirtyChange={setDirty}
      onPage={(apiCursor) => void navigate({ to: '/admin/requests', search: { ...search, apiCursor } })} /></div>
    <div><AccessRequestReview scope={{ ...(search.projectId ? { projectId: search.projectId } : {}), state: search.state, ...(search.accessCursor ? { cursor: search.accessCursor } : {}) }}
      title={t('admin.requests.app')} empty={t('admin.requests.appEmpty')} onPage={(accessCursor) => void navigate({ to: '/admin/requests', search: { ...search, accessCursor } })} /></div>
  </Stack>;
}
