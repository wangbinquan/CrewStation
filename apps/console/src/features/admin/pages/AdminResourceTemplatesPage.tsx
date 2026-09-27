import { useNavigate, useSearch } from '@tanstack/react-router';
import { useT } from '../../../shared/lib/useT';
import catalog from '../../../shared/ui/CapabilityCatalog.module.css';
import { Tabs } from '../../../shared/ui/Tabs';
import { ResourceCatalogSection } from '../components/plans/ResourceCatalogSection';
import { ProjectManagementNav } from '../components/projects/ProjectManagementNav';
import { AdminSection } from './AdminSection';

export function AdminResourceTemplatesPage() {
  const t = useT(), navigate = useNavigate(), search = useSearch({ strict: false });
  const kind = search.kind === 'task' ? 'task' : 'service';
  return <AdminSection title={t('nav.admin.projects')} description={t('admin.resources.templatesDescription')}>
    <ProjectManagementNav />
    <p className={catalog.hint}>{t('admin.resources.sharedScope')}</p>
    <Tabs label={t('admin.resources.templates')} value={kind} items={['service', 'task'].map((value) => ({ value, label: t(`admin.resources.${value}Template`) }))}
      onChange={(value) => void navigate({ to: '/admin/projects/resource-templates', search: { kind: value === 'task' ? 'task' : 'service' } })}>
      <ResourceCatalogSection key={kind} kind={kind} search={typeof search.q === 'string' ? search.q : ''} onSearch={(q) => void navigate({ to: '/admin/projects/resource-templates', search: { kind, q }, resetScroll: false })} />
    </Tabs>
  </AdminSection>;
}
