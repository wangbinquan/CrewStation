import type { ProjectSummary } from '@crewstation/contracts';
import { Link } from '@tanstack/react-router';
import { useT } from '../../../../shared/lib/useT';
import { useDateText } from '../../../../shared/lib/useDateText';
import { DataTable } from '../../../../shared/ui/DataTable';
import { ProjectStateBadge } from '../ProjectStateBadge';
import { DeploymentFact, DevelopmentFact, HealthFact, SummaryChecked } from './SummaryFacts';
import { summaryIsFresh } from '../../model/projectSummaryState';
import styles from './ProjectSummary.module.css';

export function ProjectSummaryTable({ items, available }: { readonly items: readonly ProjectSummary[]; readonly available: boolean }) {
  const t = useT(), date = useDateText();
  const columns = ['identity', 'development', 'preview', 'prod', 'health', 'actions'].map((key) => t(`projects.summary.${key}`));
  return <DataTable columns={columns} className={styles.table}>{items.map((item) => {
    const p = item.project, canDevelop = available && summaryIsFresh(item) && p.state === 'active' && item.role !== 'tester';
    return <tr key={p.id}>
      <td className={styles.identity}><div className={styles.actions}><Link to="/projects/$projectId" params={{ projectId: p.id }}><strong>{p.name}</strong></Link><ProjectStateBadge state={p.state} /></div>
        <div className={styles.muted}><code>{p.slug}</code> · {item.ownerName ?? p.ownerUserId} · {t(`projects.role.${item.role}`)}</div>
        {p.message ? <small className={styles.failure}>{p.message}</small> : null}
        <details><summary>{t('projects.summary.more')}</summary><div>{t(`projects.kind.${p.kind}`)}</div><code>{p.namespace}</code><div>{date(p.createdAt)}</div><code>{p.ownerUserId}</code><div><SummaryChecked checkedAt={item.checkedAt} /></div></details>
        {!summaryIsFresh(item) ? <p className={styles.muted}>{t('projects.summary.stale')}</p> : null}</td>
      <td><DevelopmentFact item={item} /></td><td><DeploymentFact item={item} name="preview" canOpen={available && summaryIsFresh(item)} /></td>
      <td><DeploymentFact item={item} name="prod" canOpen={available && summaryIsFresh(item)} /></td><td><HealthFact item={item} /></td>
      <td><div className={styles.fact}>{canDevelop ? <Link to="/projects/$projectId/dev-session" params={{ projectId: p.id }}>{t(item.development.status === 'ready' && item.development.value ? 'projects.summary.continue' : 'projects.summary.openDevelopment')}</Link> : null}
        {available && (item.role === 'admin' || item.role === 'owner') && (p.state === 'failed' || p.state === 'provisioning') ? <Link to={item.role === 'admin' ? '/admin/projects/$projectId/provisioning' : '/projects/$projectId/provisioning'} params={{ projectId: p.id }}>{t('projects.provision.title')}</Link> : null}</div></td>
    </tr>;
  })}</DataTable>;
}
