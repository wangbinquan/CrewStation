import { Link } from '@tanstack/react-router';
import type { ProjectPageEntry } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { useDateText } from '../../../../shared/lib/useDateText';
import { DataTable } from '../../../../shared/ui/DataTable';
import { Badge } from '../../../../shared/ui/Badge';
import styles from './ProjectDirectory.module.css';

export function ProjectDirectoryTable({ items, available }: { readonly items: readonly ProjectPageEntry[]; readonly available: boolean }) {
  const t = useT(), date = useDateText();
  return <DataTable className={styles.table} columns={['project', 'kind', 'owner', 'state', 'actions'].map((key) => t(`admin.directory.${key}`))}>
    {items.map(({ project: p, ownerName }) => <tr key={p.id}>
      <td><Link to={p.kind === 'DigitalWorker' ? '/projects/$projectId' : '/admin/integrations/$projectId'} params={{ projectId: p.id }}><strong>{p.name}</strong></Link><div className={styles.muted}><code>{p.slug}</code></div>
        <details><summary>{t('admin.directory.details')}</summary><div><code>{p.id}</code></div><div><code>{p.namespace}</code></div><div>{date(p.createdAt)}</div></details></td>
      <td>{t(`projects.kind.${p.kind}`)}</td><td>{ownerName ?? p.ownerUserId}</td>
      <td><Badge tone={p.state === 'failed' ? 'danger' : p.state === 'provisioning' ? 'warning' : 'neutral'}>{t(`projects.state.${p.state}`)}</Badge>{p.message ? <p className={styles.message}>{p.message}</p> : null}</td>
      <td>{available ? <div className={styles.actions}>{p.state === 'failed' || p.state === 'provisioning' ? <Link to="/admin/projects/$projectId/provisioning" params={{ projectId: p.id }}>{t('admin.directory.provision')}</Link> : null}
        <Link to={p.kind === 'DigitalWorker' ? '/projects/$projectId/settings' : '/admin/integrations/$projectId/settings'} params={{ projectId: p.id }} search={{ tab: 'members' }}>{t('admin.directory.members')}</Link>
        <Link to={p.kind === 'DigitalWorker' ? '/projects/$projectId/settings' : '/admin/integrations/$projectId/settings'} params={{ projectId: p.id }} search={{ tab: 'advanced' }}>{t('admin.directory.lifecycle')}</Link></div> : null}</td>
    </tr>)}
  </DataTable>;
}
