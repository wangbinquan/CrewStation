import type { ReactElement } from 'react';
import { projectRoute } from '../../../app/router/projectRoute';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { PublishForm } from '../components/PublishForm';
import { QueryStatus } from '../components/QueryStatus';
import { ReleaseHistoryCard } from '../components/ReleaseHistoryCard';
import { TagCard } from '../components/TagCard';
import { TrafficSwitchCard } from '../components/TrafficSwitchCard';
import { useServiceOfProject } from '../model/useServiceOfProject';
import styles from './ReleasePage.module.css';

/** 发布页：发布控制、发布历史、切流记录与标签列表。 */
export function ReleasePage(): ReactElement {
  const t = useT();
  const { projectId } = projectRoute.useParams();
  const { serviceId, isPending, error } = useServiceOfProject(projectId);
  return (
    <>
      <PageHeader title={t('release.title')} description={[t('release.line1'), t('release.line2')]} />
      <QueryStatus isPending={isPending} error={error} loadingKey="release.loading" errorKey="release.error" />
      {serviceId === undefined && !isPending ? <p className={styles.note}>{t('release.noService')}</p> : null}
      {serviceId !== undefined ? (
        <div className={styles.stack}>
          <PublishForm serviceId={serviceId} projectId={projectId} />
          <ReleaseHistoryCard serviceId={serviceId} />
          <TrafficSwitchCard serviceId={serviceId} />
          <TagCard serviceId={serviceId} />
        </div>
      ) : null}
    </>
  );
}
