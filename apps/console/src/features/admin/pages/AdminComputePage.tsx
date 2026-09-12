import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { ComputeProfilesSection } from '../components/ComputeProfilesSection';
import { AdminSection } from './AdminSection';

export function AdminComputePage(): ReactElement {
  const t = useT();
  return (
    <AdminSection title={t('nav.admin.compute')} description={t('admin.compute.hint')}>
      <ComputeProfilesSection />
    </AdminSection>
  );
}
