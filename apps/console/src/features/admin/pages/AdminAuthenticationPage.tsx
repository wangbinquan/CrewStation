import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { ForwardingCard } from '../components/auth/ForwardingCard';
import { LoginMethodsCard } from '../components/auth/LoginMethodsCard';
import { ProvidersCard } from '../components/auth/ProvidersCard';
import { AdminSection } from './AdminSection';

/** 管理空间 → 认证（RFC-005 §6）：登录方式、身份提供方、身份转发三张卡。 */
export function AdminAuthenticationPage(): ReactElement {
  const t = useT();
  return (
    <AdminSection title={t('nav.admin.authentication')} description={t('admin.auth.pageHint')}>
      <LoginMethodsCard />
      <ProvidersCard />
      <ForwardingCard />
    </AdminSection>
  );
}
