import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';

export function ReleasePage(): ReactElement {
  const t = useT();
  return (
    <>
      <PageHeader title={t('release.title')} description={[t('release.line1'), t('release.line2')]} />
      <EmptyState title={t('release.emptyTitle')} description={t('release.emptyDescription')} />
    </>
  );
}
