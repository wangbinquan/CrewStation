import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { PublishControls } from '../components/PublishControls';
import { SlotCard } from '../components/SlotCard';
import styles from './ProjectOverviewPage.module.css';

export function ProjectOverviewPage(): ReactElement {
  const t = useT();
  return (
    <>
      <PageHeader
        title={t('projects.overview.title')}
        description={[t('projects.overview.line1'), t('projects.overview.line2')]}
        actions={<PublishControls />}
      />
      <div className={styles.slots}>
        <SlotCard slot="preview" />
        <SlotCard slot="prod" />
      </div>
      <Card title={t('projects.releases.title')}>
        <EmptyState title={t('projects.releases.emptyTitle')} description={t('projects.releases.emptyDescription')} />
      </Card>
    </>
  );
}
