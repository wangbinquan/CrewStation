import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';

export function ConfigPage(): ReactElement {
  const t = useT();
  return (
    <>
      <PageHeader title={t('config.title')} description={[t('config.line1'), t('config.line2')]} />
      <EmptyState title={t('config.emptyTitle')} description={t('config.emptyDescription')} />
    </>
  );
}
