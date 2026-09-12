import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { ServicePlansSection } from '../components/ServicePlansSection';
import { AdminSection } from './AdminSection';

export function AdminServicePlansPage(): ReactElement {
  const t = useT();
  return (
    <AdminSection title={t('nav.admin.servicePlans')} description={t('admin.plans.hint')}>
      <ServicePlansSection />
    </AdminSection>
  );
}
