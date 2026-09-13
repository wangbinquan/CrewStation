import type { ReactElement } from 'react';
import { Link } from '@tanstack/react-router';
import { useT } from '../../../shared/lib/useT';
import { EgressEntriesSection } from '../components/EgressEntriesSection';
import { AdminSection } from './AdminSection';

/** 本页维护规则，申请审批有单独入口并可返回这里核对规则。 */
export function AdminEgressPage(): ReactElement {
  const t = useT();
  return (
    <AdminSection title={t('nav.admin.egress')} description={t('admin.egress.hint')}>
      <EgressEntriesSection />
      <p><Link to="/admin/requests" search={{ tab: 'egress', state: 'pending' }}>{t('admin.requests.openEgress')}</Link></p>
    </AdminSection>
  );
}
