import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../shared/lib/useT';
import { EmptyState } from '../../shared/ui/EmptyState';
import { AppShell } from './AppShell';
import { WorkbenchNav } from './WorkbenchNav';

/** 全局 404。挂在根路由上，两个空间的外壳都还没进，所以自带租户外壳，免得整页只剩一段文字。 */
export function NotFound(): ReactElement {
  const t = useT();
  return (
    <AppShell nav={<WorkbenchNav />}>
      <EmptyState
        title={t('notFound.title')}
        description={t('notFound.description')}
        action={<Link to="/projects">{t('notFound.backToProjects')}</Link>}
      />
    </AppShell>
  );
}
