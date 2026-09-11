import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../shared/lib/useT';
import { EmptyState } from '../../shared/ui/EmptyState';

export function NotFound(): ReactElement {
  const t = useT();
  return (
    <EmptyState
      title={t('notFound.title')}
      description={t('notFound.description')}
      action={<Link to="/">{t('notFound.backToProjects')}</Link>}
    />
  );
}
