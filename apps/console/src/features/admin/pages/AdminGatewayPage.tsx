import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { GatewaySection } from '../components/GatewaySection';
import { AdminSection } from './AdminSection';

export function AdminGatewayPage(): ReactElement {
  const t = useT();
  return (
    <AdminSection title={t('nav.admin.gateway')} description={t('admin.gateway.hint')}>
      <GatewaySection />
    </AdminSection>
  );
}
