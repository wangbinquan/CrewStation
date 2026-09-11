import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';

export function AdminPage(): ReactElement {
  const t = useT();
  return (
    <>
      <PageHeader title={t('admin.title')} description={[t('admin.line1'), t('admin.line2')]} />
      <EmptyState title={t('admin.emptyTitle')} description={t('admin.emptyDescription')} />
    </>
  );
}
