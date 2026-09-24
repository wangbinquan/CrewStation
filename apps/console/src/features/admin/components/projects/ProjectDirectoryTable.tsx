import { Link } from '@tanstack/react-router';
import type { ProjectPageEntry } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { useDateText } from '../../../../shared/lib/useDateText';
import { DataTable } from '../../../../shared/ui/DataTable';
import { Badge } from '../../../../shared/ui/Badge';
import styles from './ProjectDirectory.module.css';
import { ButtonLink } from '../../../../shared/ui/navigation/ButtonLink';

/** 「类型」列只在接入容器目录里有：项目管理只列数字人（2026-09-24 裁定）。 */
export function ProjectDirectoryTable({ items, available, integration }: { readonly items: readonly ProjectPageEntry[]; readonly available: boolean; readonly integration: boolean }) {
  const t = useT(), date = useDateText();
  const columns = integration ? ['project', 'kind', 'owner', 'state', 'actions'] : ['project', 'owner', 'state', 'actions'];
  return <DataTable className={styles.table} columns={columns.map((key) => t(`admin.directory.${key}`))}>
    {items.map(({ project: p, ownerName }) => <tr key={p.id}>
      <td><Link to={p.kind === 'DigitalWorker' ? '/projects/$projectId' : '/admin/integrations/$projectId'} params={{ projectId: p.id }}><strong>{p.name}</strong></Link><div className={styles.muted}><code>{p.slug}</code></div>
        <details><summary>{t('admin.directory.details')}</summary><div><code>{p.id}</code></div><div><code>{p.namespace}</code></div><div>{date(p.createdAt)}</div></details></td>
      {integration ? <td>{t(`projects.kind.${p.kind}`)}</td> : null}<td>{ownerName ?? p.ownerUserId}</td>
      <td><Badge tone={p.state === 'failed' ? 'danger' : p.state === 'provisioning' ? 'warning' : 'neutral'}>{t(`projects.state.${p.state}`)}</Badge>{p.message ? <p className={styles.message}>{p.message}</p> : null}</td>
      <td>{available ? <div className={styles.actions}>{p.state === 'failed' || p.state === 'provisioning' ? <ButtonLink size="small" to="/admin/projects/$projectId/provisioning" params={{ projectId: p.id }}>{t('admin.directory.provision')}</ButtonLink> : null}
        <ButtonLink size="small" to="/admin/projects/$projectId/resources" params={{ projectId: p.id }}>{t('admin.resources.title')}</ButtonLink>
        <ButtonLink size="small" to={p.kind === 'DigitalWorker' ? '/projects/$projectId/settings' : '/admin/integrations/$projectId/settings'} params={{ projectId: p.id }} search={{ tab: 'members' }}>{t('admin.directory.members')}</ButtonLink>
        <ButtonLink size="small" to={p.kind === 'DigitalWorker' ? '/projects/$projectId/settings' : '/admin/integrations/$projectId/settings'} params={{ projectId: p.id }} search={{ tab: 'advanced' }}>{t('admin.directory.lifecycle')}</ButtonLink></div> : null}</td>
    </tr>)}
  </DataTable>;
}
