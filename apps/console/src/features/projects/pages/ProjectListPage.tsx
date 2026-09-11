import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';

export function ProjectListPage(): ReactElement {
  const t = useT();
  return (
    <>
      <PageHeader title={t('projects.list.title')} description={[t('projects.list.line1'), t('projects.list.line2')]} />
      <EmptyState
        title={t('projects.list.emptyTitle')}
        description={t('projects.list.emptyDescription')}
        action={
          <Link to="/projects/$projectId" params={{ projectId: 'sample' }}>
            {t('projects.list.sampleLink')}
          </Link>
        }
      />
    </>
  );
}
