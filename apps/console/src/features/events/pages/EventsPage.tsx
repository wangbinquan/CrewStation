import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';

export function EventsPage(): ReactElement {
  const t = useT();
  return (
    <>
      <PageHeader title={t('events.title')} description={[t('events.line1'), t('events.line2')]} />
      <EmptyState title={t('events.emptyTitle')} description={t('events.emptyDescription')} />
    </>
  );
}
