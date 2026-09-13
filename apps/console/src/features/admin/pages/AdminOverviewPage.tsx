import type { ReactElement } from 'react';
import { Link } from '@tanstack/react-router';
import { useT } from '../../../shared/lib/useT';
import { AdminSection } from './AdminSection';
import { AdminOverviewCards } from '../components/AdminOverviewCards';
import { AdminTodos } from '../components/overview/AdminTodos';

/** /admin：当前真实待办和管理入口，待办只导航到现有操作页。 */
export function AdminOverviewPage(): ReactElement {
  const t = useT();
  return (
    <AdminSection title={t('nav.admin.overview')} description={t('admin.overview.hint')}>
      <p><Link to="/admin/projects/new" search={{ scope: 'digital-worker' }}>{t('projects.wizard.title.digital-worker')}</Link> · <Link to="/admin/projects/new" search={{ scope: 'integration' }}>{t('projects.wizard.title.integration')}</Link></p>
      <AdminTodos />
      <AdminOverviewCards />
    </AdminSection>
  );
}
