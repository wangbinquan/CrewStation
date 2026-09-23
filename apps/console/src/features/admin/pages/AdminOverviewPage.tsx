import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../shared/lib/useT';
import { AdminSection } from './AdminSection';
import { AdminOverviewCards } from '../components/AdminOverviewCards';
import { AdminTodos } from '../components/overview/AdminTodos';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';

/**
 * /admin：最上面是集群状态（2026-09-23 作者裁定从集群管理挪来；由 app/ 装配传入，features 之间不互相引用），
 * 其下是当前真实待办和管理入口，待办只导航到现有操作页。
 */
export function AdminOverviewPage({ status }: { readonly status?: ReactNode }): ReactElement {
  const t = useT();
  return (
    <AdminSection title={t('nav.admin.overview')} description={t('admin.overview.hint')}
      actions={<><ButtonLink variant="primary" to="/admin/projects/new" search={{ scope: 'digital-worker' }}>{t('projects.wizard.title.digital-worker')}</ButtonLink><ButtonLink to="/admin/projects/new" search={{ scope: 'integration' }}>{t('projects.wizard.title.integration')}</ButtonLink></>}>
      {status}
      <AdminTodos />
      <AdminOverviewCards />
    </AdminSection>
  );
}
