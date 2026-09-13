import type { ReactElement } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { PROJECT_PATHS } from '../../../shared/project/projectPaths';
import { parseReleaseSearch } from '../../../shared/project/releaseSearch';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Button } from '../../../shared/ui/Button';
import { PublishForm } from '../components/PublishForm';
import { ReleaseHistoryCard } from '../components/ReleaseHistoryCard';
import { TagCard } from '../components/TagCard';
import { TrafficSwitchCard } from '../components/TrafficSwitchCard';
import { SelectedRelease } from '../components/SelectedRelease';
import { useServiceOfProject } from '../model/useServiceOfProject';
import styles from './ReleasePage.module.css';

/** 发布页：发布控制、发布历史、切流记录与标签列表。 */
export function ReleasePage(): ReactElement {
  const t = useT();
  const { projectId, space } = useProjectScope(), navigate = useNavigate();
  const search = parseReleaseSearch(useSearch({ strict: false }));
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const canPublish = !me.error && !!me.data && (me.data.isAdmin || me.data.memberships.some((member) => member.projectId === projectId && ['owner', 'developer'].includes(member.role)));
  const updateSearch = (next: typeof search) => void navigate({ to: PROJECT_PATHS[space].release, params: { projectId }, search: next });
  const { serviceId, isPending, error } = useServiceOfProject(projectId);
  return (
    <>
      <PageHeader title={t('release.title')} description={[t('release.line1')]} actions={!search.source ? <Button variant="primary" disabled={!canPublish || !serviceId || !!error} onClick={() => updateSearch({ ...search, source: 'repository' })}>{t('release.prepare.open')}</Button> : undefined} />
      <QueryStatus isPending={isPending} error={error} loadingKey="release.loading" errorKey="release.error" />
      {serviceId === undefined && !isPending && !error ? <p className={styles.note}>{t('release.noService')}</p> : null}
      {serviceId !== undefined ? (
        <div className={styles.stack}>
          {search.source ? <PublishForm key={projectId} serviceId={serviceId} projectId={projectId} source={search.source} canPublish={canPublish && !error} onSource={(source) => updateSearch({ ...search, source })} onClose={() => updateSearch({ release: search.release })} onAccepted={(release) => updateSearch({ release: release.id })} /> : null}
          {search.release ? <SelectedRelease key={search.release} releaseId={search.release} serviceId={serviceId} /> : null}
          <ReleaseHistoryCard serviceId={serviceId} onSelect={(release) => updateSearch({ ...search, release })} />
          <TrafficSwitchCard serviceId={serviceId} />
          <details><summary>{t('release.tags.title')}</summary><TagCard serviceId={serviceId} /></details>
        </div>
      ) : null}
    </>
  );
}
