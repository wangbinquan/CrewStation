import { useNavigate, useSearch } from '@tanstack/react-router';
import { parseProjectDirectorySearch } from '../../../shared/admin/projectDirectorySearch';
import { ProjectDirectory } from './projects/ProjectDirectory';

/** 接入目录仍由服务端限制类型，当前页可搜索、筛选和续页。 */
export function IntegrationProjectsSection() {
  const navigate = useNavigate(), search = parseProjectDirectorySearch(useSearch({ strict: false }), true);
  return <ProjectDirectory integration search={search} apply={(next) => void navigate({ to: '/admin/capabilities', search: { tab: 'integrations', ...next } })} />;
}
