import type { ReactElement } from 'react';
import { useT } from '../../shared/lib/useT';
import { EmptyState } from '../../shared/ui/EmptyState';
import { AppShell } from './AppShell';
import { ButtonLink } from '../../shared/ui/navigation/ButtonLink';

/** 全局 404。挂在根路由上，两个空间的外壳都还没进，所以自带租户外壳，免得整页只剩一段文字。 */
export function NotFound(): ReactElement {
  const t = useT();
  return (
    <AppShell nav={null}>
      <EmptyState
        title={t('notFound.title')}
        description={t('notFound.description')}
        action={<ButtonLink to="/projects">{t('notFound.backToProjects')}</ButtonLink>}
      />
    </AppShell>
  );
}
