import { useState } from 'react';
import { Button } from '../../../../shared/ui/Button';
import { CatalogCell } from '../../../../shared/ui/catalog/CatalogCell';
import catalog from '../../../../shared/ui/CapabilityCatalog.module.css';
import { ProjectSummaryDetails } from './ProjectSummaryDetails';
import type { ProjectSummary } from '@crewstation/contracts';
import { Link } from '@tanstack/react-router';
import { useT } from '../../../../shared/lib/useT';
import { DataTable } from '../../../../shared/ui/DataTable';
import { ProjectStateBadge } from '../ProjectStateBadge';
import { DeploymentFact, DevelopmentFact } from './SummaryFacts';
import { summaryIsFresh } from '../../model/projectSummaryState';
import styles from './ProjectSummary.module.css';
import { ButtonLink } from '../../../../shared/ui/navigation/ButtonLink';

export function ProjectSummaryTable({ items, available, onOwner }: { readonly items: readonly ProjectSummary[]; readonly available: boolean; readonly onOwner?: (item: ProjectSummary) => void }) {
  const t = useT(), [selected, setSelected] = useState<string>();
  const detail = items.find((item) => item.project.id === selected);
  const columns = ['identity', 'owner', 'development', 'preview', 'prod', 'actions'].map((key) => t(`projects.summary.${key}`));
  return <><DataTable columns={columns} className={catalog.catalogTable}>{items.map((item) => {
    const p = item.project, canDevelop = available && summaryIsFresh(item) && p.state === 'active' && item.role !== 'tester';
    return <tr key={p.id}>
      <td className={styles.identity}><div className={styles.actions}><Link to="/projects/$projectId" params={{ projectId: p.id }}><strong>{p.name}</strong></Link><ProjectStateBadge state={p.state} /></div>
        <div className={styles.muted}><code>{p.slug}</code> · {t(`projects.role.${item.role}`)}</div>
        {p.message ? <small className={styles.failure}>{p.message}</small> : null}
        {!summaryIsFresh(item) ? <p className={styles.muted}>{t('projects.summary.stale')}</p> : null}</td>
      <CatalogCell label={t('projects.summary.owner')}><span className={catalog.owner}>{item.ownerName ? <Button size="small" onClick={() => onOwner?.(item)}>{item.ownerName}</Button> : t('catalog.ownerUnknown')}</span></CatalogCell>
      <CatalogCell label={t('projects.summary.development')}><DevelopmentFact item={item} compact /></CatalogCell><CatalogCell label={t('projects.summary.preview')}><DeploymentFact item={item} name="preview" compact canOpen={available && summaryIsFresh(item)} /></CatalogCell>
      <CatalogCell label={t('projects.summary.prod')}><DeploymentFact item={item} name="prod" compact canOpen={available && summaryIsFresh(item)} /></CatalogCell>
      <td><div className={catalog.rowActions}>{canDevelop ? <ButtonLink size="small" to="/projects/$projectId/dev-session" params={{ projectId: p.id }}>{t(item.development.status === 'ready' && item.development.value ? 'projects.summary.continue' : 'projects.summary.openDevelopment')}</ButtonLink> : null}
        {available && (item.role === 'admin' || item.role === 'owner') && (p.state === 'failed' || p.state === 'provisioning') ? <ButtonLink size="small" to={item.role === 'admin' ? '/admin/projects/$projectId/provisioning' : '/projects/$projectId/provisioning'} params={{ projectId: p.id }}>{t('projects.provision.title')}</ButtonLink> : null}<Button size="small" onClick={() => setSelected(p.id)}>{t('catalog.details')}</Button></div></td>
    </tr>;
  })}</DataTable>{detail ? <ProjectSummaryDetails item={detail} onClose={() => setSelected(undefined)} /> : null}</>;
}
