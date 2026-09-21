import { useNavigate, useSearch } from '@tanstack/react-router';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Tabs } from '../../../shared/ui/Tabs';
import { ResourceCatalogSection } from '../components/plans/ResourceCatalogSection';
import { ProjectManagementNav } from '../components/projects/ProjectManagementNav';
import { AdminSection } from './AdminSection';

export function AdminResourceTemplatesPage() {
  const t = useT(), navigate = useNavigate(), search = useSearch({ strict: false });
  const kind = search.kind === 'task' ? 'task' : 'service';
  return <AdminSection title={t('nav.admin.projects')} description={t('admin.resources.templatesDescription')}>
    <ProjectManagementNav />
    <ActionNote tone="neutral">{t('admin.resources.sharedScope')}</ActionNote>
    <Tabs label={t('admin.resources.templates')} value={kind} items={['service', 'task'].map((value) => ({ value, label: t(`admin.resources.${value}Template`) }))}
      onChange={(value) => void navigate({ to: '/admin/projects/resource-templates', search: { kind: value === 'task' ? 'task' : 'service' } })}>
      <ResourceCatalogSection key={kind} kind={kind} />
    </Tabs>
  </AdminSection>;
}
