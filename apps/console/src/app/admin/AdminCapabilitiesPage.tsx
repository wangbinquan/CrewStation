import { useNavigate, useSearch } from '@tanstack/react-router';
import { AdminIntegrationsPage } from '../../features/admin';
import { CatalogManagementPage } from '../../features/catalog';
import { EventTypesCard } from '../../features/events';
import { parseCapabilitySearch } from '../../shared/admin/managementSearch';
import type { CapabilityTab } from '../../shared/admin/managementSearch';
import { useT } from '../../shared/lib/useT';
import { PageHeader } from '../../shared/ui/PageHeader';
import { Tabs } from '../../shared/ui/Tabs';

export function AdminCapabilitiesPage() {
  const t = useT(), navigate = useNavigate(), search = parseCapabilitySearch(useSearch({ strict: false }));
  const tabs: CapabilityTab[] = ['integrations', 'api', 'events'];
  return <>
    <PageHeader title={t('nav.admin.capabilities')} description={t('admin.capabilities.hint')} />
    <Tabs label={t('nav.admin.capabilities')} items={tabs.map((value) => ({ value, label: t(`admin.capabilities.${value}`) }))} value={search.tab}
      onChange={(tab) => void navigate({ to: '/admin/capabilities', search: parseCapabilitySearch({ tab }) })}>
      {search.tab === 'integrations' ? <AdminIntegrationsPage embedded /> : null}
      {search.tab === 'api' ? <CatalogManagementPage projectId={search.projectId} proxy={search.proxy} operation={search.operation}
        q={search.q} cursor={search.cursor} onDirectoryChange={(q, cursor) => void navigate({ to: '/admin/capabilities', search: { ...search, q, cursor } })}
        onProjectChange={(projectId) => void navigate({ to: '/admin/capabilities', search: { ...search, projectId } })}
        onClearContext={() => void navigate({ to: '/admin/capabilities', search: { ...search, proxy: undefined, operation: undefined } })} /> : null}
      {search.tab === 'events' ? <EventTypesCard management /> : null}
    </Tabs>
  </>;
}
