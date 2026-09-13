import type { ReactElement } from 'react';
import { Link } from '@tanstack/react-router';
import { useT } from '../../../shared/lib/useT';
import { AdminSection } from './AdminSection';
import { AdminOverviewCards } from '../components/AdminOverviewCards';

/** /admin：管理空间的首页。只说清这里有哪些事、各自通向哪一页，不重复渲染各页的数据。 */
export function AdminOverviewPage(): ReactElement {
  const t = useT();
  return (
    <AdminSection title={t('admin.title')} description={[t('admin.line1'), t('admin.line2')]}>
      <p><Link to="/admin/projects/new" search={{ scope: 'digital-worker' }}>{t('projects.wizard.title.digital-worker')}</Link> · <Link to="/admin/projects/new" search={{ scope: 'integration' }}>{t('projects.wizard.title.integration')}</Link></p>
      <AdminOverviewCards />
    </AdminSection>
  );
}
