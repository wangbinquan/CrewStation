import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';

export function CatalogPage(): ReactElement {
  const t = useT();
  return (
    <>
      <PageHeader title={t('catalog.title')} description={[t('catalog.line1'), t('catalog.line2')]} />
      <EmptyState title={t('catalog.emptyTitle')} description={t('catalog.emptyDescription')} />
    </>
  );
}
