import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';

export function CapabilitiesPage(): ReactElement {
  const t = useT();
  return (
    <>
      <PageHeader title={t('capabilities.title')} description={[t('capabilities.line1'), t('capabilities.line2')]} />
      <EmptyState title={t('capabilities.emptyTitle')} description={t('capabilities.emptyDescription')} />
    </>
  );
}
