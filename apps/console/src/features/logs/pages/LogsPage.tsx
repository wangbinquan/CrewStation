import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';

export function LogsPage(): ReactElement {
  const t = useT();
  return (
    <>
      <PageHeader title={t('logs.title')} description={[t('logs.line1'), t('logs.line2')]} />
      <EmptyState title={t('logs.emptyTitle')} description={t('logs.emptyDescription')} />
    </>
  );
}
