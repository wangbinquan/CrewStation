import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { EgressRequestsSection } from '../../features/admin';
import { CatalogRequestsPage } from '../../features/catalog';
import { parseRequestSearch } from '../../shared/admin/managementSearch';
import type { RequestStatus } from '../../shared/admin/managementSearch';
import { useT } from '../../shared/lib/useT';
import { Button } from '../../shared/ui/Button';
import { FormField } from '../../shared/ui/FormField';
import { PageHeader } from '../../shared/ui/PageHeader';
import { Tabs } from '../../shared/ui/Tabs';
import styles from './AdminPages.module.css';

export function AdminRequestsPage() {
  const t = useT(), navigate = useNavigate(), search = parseRequestSearch(useSearch({ strict: false }));
  const states: RequestStatus[] = ['pending', 'approved', 'rejected', 'all'];
  return <>
    <PageHeader title={t('nav.admin.requests')} description={t('admin.requests.hint')} />
    <div className={styles.filters}>
      <FormField label={t('admin.requests.state')}><select value={search.state} onChange={(event) => void navigate({ to: '/admin/requests', search: parseRequestSearch({ ...search, state: event.target.value }) })}>
        {states.map((state) => <option key={state} value={state}>{t(`admin.requests.${state}`)}</option>)}
      </select></FormField>
      {search.projectId ? <p>{t('admin.requests.projectContext')} <code>{search.projectId}</code> <Button onClick={() => void navigate({ to: '/admin/requests', search: { ...search, projectId: undefined } })}>{t('admin.requests.clearProject')}</Button></p> : null}
    </div>
    <Tabs label={t('nav.admin.requests')} items={['api', 'egress'].map((value) => ({ value, label: t(`admin.requests.${value}`) }))} value={search.tab}
      onChange={(tab) => void navigate({ to: '/admin/requests', search: parseRequestSearch({ ...search, tab }) })}>
      <div hidden={search.tab !== 'api'} key={`api:${search.projectId ?? 'all'}`}><CatalogRequestsPage projectId={search.projectId} state={search.state} /></div>
      <div hidden={search.tab !== 'egress'} key={`egress:${search.projectId ?? 'all'}`}><p><Link to="/admin/egress">{t('admin.requests.openRules')}</Link></p><EgressRequestsSection projectId={search.projectId} state={search.state} /></div>
    </Tabs>
  </>;
}
