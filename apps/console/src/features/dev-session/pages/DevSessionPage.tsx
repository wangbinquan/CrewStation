import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';

export function DevSessionPage(): ReactElement {
  const t = useT();
  return (
    <>
      <PageHeader title={t('devSession.title')} description={[t('devSession.line1'), t('devSession.line2')]} />
      <EmptyState title={t('devSession.emptyTitle')} description={t('devSession.emptyDescription')} />
    </>
  );
}
