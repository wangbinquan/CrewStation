import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { IntegrationProjectsSection } from '../components/IntegrationProjectsSection';
import { AdminSection } from './AdminSection';

/** 接入容器：APIProxy 与 EventProducer 两类平台项目。它们不出现在租户的项目列表里（RFC-002）。 */
export function AdminIntegrationsPage(): ReactElement {
  const t = useT();
  return (
    <AdminSection title={t('nav.admin.integrations')} description={t('admin.integrations.hint')}>
      <IntegrationProjectsSection />
    </AdminSection>
  );
}
