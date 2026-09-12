import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { EgressEntriesSection } from '../components/EgressEntriesSection';
import { EgressRequestsSection } from '../components/EgressRequestsSection';
import { AdminSection } from './AdminSection';

/** 白名单条目与待裁定的申请放在同一页：批一条申请紧接着就要看它落成了哪条条目。 */
export function AdminEgressPage(): ReactElement {
  const t = useT();
  return (
    <AdminSection title={t('nav.admin.egress')} description={t('admin.egress.hint')}>
      <EgressEntriesSection />
      <EgressRequestsSection />
    </AdminSection>
  );
}
