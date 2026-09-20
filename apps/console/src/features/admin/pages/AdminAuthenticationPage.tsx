import { useNavigate, useSearch } from '@tanstack/react-router';
import { useT } from '../../../shared/lib/useT';
import { Stack } from '../../../shared/ui/Stack';
import { Tabs } from '../../../shared/ui/Tabs';
import { ForwardingCard } from '../components/auth/ForwardingCard';
import { LoginMethodsCard } from '../components/auth/LoginMethodsCard';
import { ProvidersCard } from '../components/auth/ProvidersCard';
import { parseAuthenticationSearch } from '../model/authenticationSearch';
import type { AuthenticationTab } from '../model/authenticationSearch';
import { AdminSection } from './AdminSection';

export function AdminAuthenticationPage() {
  const t = useT(), navigate = useNavigate(), search = parseAuthenticationSearch(useSearch({ strict: false }));
  return <AdminSection title={t('nav.admin.authentication')} description={t('admin.auth.pageHint')}>
    <Tabs label={t('nav.admin.authentication')} value={search.tab} items={[{ value: 'methods', label: t('admin.auth.methodsTitle') }, { value: 'fields', label: t('admin.identity.fieldsTab') }]}
      onChange={(tab) => { if (tab !== search.tab) void navigate({ to: '/admin/authentication', search: { tab: tab as AuthenticationTab } }); }}>
      {search.tab === 'fields' ? <ForwardingCard /> : <Stack><ProvidersCard /><LoginMethodsCard /></Stack>}
    </Tabs>
  </AdminSection>;
}
