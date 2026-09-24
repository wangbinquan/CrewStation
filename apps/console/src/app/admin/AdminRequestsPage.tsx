import { useNavigate, useSearch } from '@tanstack/react-router';
import { parseRequestSearch } from '../../shared/admin/managementSearch';
import type { RequestStatus } from '../../shared/admin/managementSearch';
import { useT } from '../../shared/lib/useT';
import { Button } from '../../shared/ui/Button';
import { FormField } from '../../shared/ui/FormField';
import { PageHeader } from '../../shared/ui/PageHeader';
import styles from './AdminPages.module.css';
import { requestScopeKey } from '../../shared/admin/requestPageState';
import { AdminRequestPanels } from './AdminRequestPanels';

export function AdminRequestsPage() {
  const t = useT(), navigate = useNavigate(), search = parseRequestSearch(useSearch({ strict: false }));
  const states: RequestStatus[] = ['pending', 'approved', 'rejected', 'all'];
  return <>
    <PageHeader title={t('nav.admin.requests')} description={t('admin.requests.hint')} />
    <div className={styles.filters}>
      <FormField label={t('admin.requests.state')}><select aria-label={t('admin.requests.state')} value={search.state} onChange={(event) => void navigate({ to: '/admin/requests', search: parseRequestSearch({ ...search, state: event.target.value, apiCursor: undefined, accessCursor: undefined }) })}>
        {states.map((state) => <option key={state} value={state}>{t(`admin.requests.${state}`)}</option>)}
      </select></FormField>
      {search.projectId ? <p>{t('admin.requests.projectContext')} <code>{search.projectId}</code> <Button size="small" onClick={() => void navigate({ to: '/admin/requests', search: { ...search, projectId: undefined, apiCursor: undefined, accessCursor: undefined } })}>{t('admin.requests.clearProject')}</Button></p> : null}
    </div>
    <p>{t('ui.requestPage.hint')}</p>
    <AdminRequestPanels key={requestScopeKey(search)} search={search} />
  </>;
}
