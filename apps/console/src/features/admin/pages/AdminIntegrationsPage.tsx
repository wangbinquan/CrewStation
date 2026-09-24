import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { IntegrationProjectsSection } from '../components/IntegrationProjectsSection';
import { AdminSection } from './AdminSection';

/** 接入容器：APIProxy 与 EventProducer 两类平台项目。它们不出现在租户的项目列表里（RFC-002），也不出现在项目管理里（2026-09-24 裁定）。 */
export function AdminIntegrationsPage({ embedded = false }: { readonly embedded?: boolean }): ReactElement {
  const t = useT();
  if (embedded) return <IntegrationProjectsSection />;
  return (
    <AdminSection title={t('nav.admin.integrations')} description={t('admin.integrations.hint')}>
      <IntegrationProjectsSection />
    </AdminSection>
  );
}
