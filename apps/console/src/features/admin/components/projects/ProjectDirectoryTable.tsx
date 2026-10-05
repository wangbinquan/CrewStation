import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { ProjectPageEntry } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { useDateText } from '../../../../shared/lib/useDateText';
import { DataTable } from '../../../../shared/ui/DataTable';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { CatalogCell } from '../../../../shared/ui/catalog/CatalogCell';
import { Dialog } from '../../../../shared/ui/dialog/Dialog';
import { DefinitionList } from '../../../../shared/ui/DefinitionList';
import { ActionRow } from '../../../../shared/ui/ActionRow';
import { ButtonLink } from '../../../../shared/ui/navigation/ButtonLink';
import styles from '../../../../shared/ui/CapabilityCatalog.module.css';
import { useOpenProjectDeletion } from '../../../../shared/admin/ProjectDeletionSlot';

export function ProjectDirectoryTable({ items, available, integration, onOwner }: {
  readonly items: readonly ProjectPageEntry[]; readonly available: boolean; readonly integration: boolean; readonly onOwner?: (item: ProjectPageEntry) => void;
}) {
  const t = useT(), date = useDateText(), [selected, setSelected] = useState<string>();
  const openDeletion = useOpenProjectDeletion();
  const columns = integration ? ['project', 'kind', 'owner', 'state', 'actions'] : ['project', 'owner', 'state', 'created', 'actions'];
  const detail = items.find((item) => item.project.id === selected);
  return <><DataTable className={styles.catalogTable} columns={columns.map((key) => key === 'created' ? t('catalog.created') : t(`admin.directory.${key}`))}>
    {items.map((item) => { const { project: p, ownerName } = item; return <tr key={p.id}>
      <td><div className={styles.identity}><Link to={p.kind === 'DigitalWorker' ? '/projects/$projectId' : '/admin/integrations/$projectId'} params={{ projectId: p.id }}><strong>{p.name}</strong></Link><code className={styles.hint}>{p.slug}</code></div></td>
      {integration ? <CatalogCell label={t('admin.directory.kind')}>{t(`projects.kind.${p.kind}`)}</CatalogCell> : null}
      <CatalogCell label={t('admin.directory.owner')}><span className={styles.owner}>{ownerName ? <Button size="small" onClick={() => onOwner?.(item)}>{ownerName}</Button> : t('catalog.ownerUnknown')}</span></CatalogCell>
      <CatalogCell label={t('admin.directory.state')}><Badge tone={p.state === 'failed' ? 'danger' : p.state === 'provisioning' ? 'warning' : 'neutral'}>{t(`projects.state.${p.state}`)}</Badge>{p.message ? <p className={styles.description}>{p.message}</p> : null}</CatalogCell>
      {!integration ? <CatalogCell label={t('catalog.created')}><span className={styles.hint}>{date(p.createdAt)}</span></CatalogCell> : null}
      <td><ActionRow>{available ? p.state === 'failed' || p.state === 'provisioning'
        ? <ButtonLink size="small" to="/admin/projects/$projectId/provisioning" params={{ projectId: p.id }}>{t('admin.directory.provision')}</ButtonLink>
        : <ButtonLink size="small" to={integration ? '/admin/integrations/$projectId' : '/admin/projects/$projectId/resources'} params={{ projectId: p.id }}>{t(integration ? 'catalog.openProject' : 'catalog.resources')}</ButtonLink> : null}
        <Button size="small" onClick={() => setSelected(p.id)}>{t('catalog.more')}</Button>
        {available && openDeletion ? <Button size="small" variant="danger" onClick={event => openDeletion(p, event.currentTarget)}>{t(p.state === 'deleting' ? 'projects.delete.progressTitle' : 'projects.delete.confirmTitle')}</Button> : null}</ActionRow></td>
    </tr>; })}
  </DataTable>{detail ? <DirectoryDetails item={detail} available={available} onClose={() => setSelected(undefined)} /> : null}</>;
}
function DirectoryDetails({ item, available, onClose }: { readonly item: ProjectPageEntry; readonly available: boolean; readonly onClose: () => void }) {
  const t = useT(), date = useDateText(), p = item.project;
  return <Dialog title={p.name} onClose={onClose} footer={available ? <ActionRow>
    <ButtonLink to="/admin/projects/$projectId/resources" params={{ projectId: p.id }}>{t('admin.resources.title')}</ButtonLink>
    <ButtonLink to={p.kind === 'DigitalWorker' ? '/projects/$projectId/settings' : '/admin/integrations/$projectId/settings'} params={{ projectId: p.id }} search={{ tab: 'members' }}>{t('admin.directory.members')}</ButtonLink>
    <ButtonLink to={p.kind === 'DigitalWorker' ? '/projects/$projectId/settings' : '/admin/integrations/$projectId/settings'} params={{ projectId: p.id }} search={{ tab: 'advanced' }}>{t('admin.directory.lifecycle')}</ButtonLink>
  </ActionRow> : undefined}><DefinitionList items={[
    { label: t('admin.directory.owner'), value: item.ownerName || t('catalog.ownerUnknown') },
    { label: t('admin.directory.state'), value: t(`projects.state.${p.state}`) },
    { label: t('catalog.identifier'), value: p.id }, { label: t('catalog.namespace'), value: p.namespace },
    { label: t('catalog.created'), value: date(p.createdAt) }, ...(p.message ? [{ label: t('catalog.reason'), value: p.message }] : []),
  ]} /></Dialog>;
}
