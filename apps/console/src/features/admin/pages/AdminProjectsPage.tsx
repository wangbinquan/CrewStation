import { useNavigate, useSearch } from '@tanstack/react-router';
import { parseProjectDirectorySearch } from '../../../shared/admin/projectDirectorySearch';
import { ProjectDirectory } from '../components/projects/ProjectDirectory';
import { useT } from '../../../shared/lib/useT';
import { AdminSection } from './AdminSection';
import { ProjectManagementNav } from '../components/projects/ProjectManagementNav';

export function AdminProjectsPage() {
  const t = useT(), navigate = useNavigate(), search = parseProjectDirectorySearch(useSearch({ strict: false }));
  return <AdminSection title={t('nav.admin.projects')} description={t('admin.directory.description')}>
    <ProjectManagementNav />
    <ProjectDirectory search={search} apply={(next) => void navigate({ to: '/admin/projects', search: next })} />
  </AdminSection>;
}
