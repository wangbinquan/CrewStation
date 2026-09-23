import { useProjectScope } from '../../../shared/project/ProjectScope';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { Card } from '../../../shared/ui/Card';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { useProjectSummary } from '../model/useProjectSummaries';
import { summaryIsFresh } from '../model/projectSummaryState';
import { DeploymentFact, SummaryChecked } from '../components/summary/SummaryFacts';
import styles from '../components/summary/ProjectSummary.module.css';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';

/** 测试者深链接都落到已有试用能力；不挂载开发、发布和配置查询。 */
export function TesterProjectPage() {
  const t = useT(), { projectId } = useProjectScope(), { me, query } = useProjectSummary(projectId);
  const error = me.error ?? query.error, item = !error && query.data?.role === 'tester' ? query.data : undefined;
  const preview = item?.preview, slot = preview?.status === 'ready' ? preview.value : undefined;
  return <>
    <PageHeader title={item?.project.name ?? t('projects.preview.title')} />
    <p>{t('projects.preview.role')}</p>
    <QueryStatus isPending={!error && (me.isPending || query.isPending)} error={error} />
    {item ? <Card compact title={t('projects.summary.preview')}>
      <DeploymentFact item={item} name="preview" canOpen={summaryIsFresh(item)} />
      {slot?.commitSha ? <p className={styles.fact}><code>{slot.commitSha}</code></p> : null}
      {preview ? <SummaryChecked checkedAt={preview.checkedAt} /> : null}
      <p>{t('projects.preview.data')}</p>
    </Card> : null}
    <ButtonLink to="/projects">{t('projects.preview.back')}</ButtonLink>
  </>;
}
