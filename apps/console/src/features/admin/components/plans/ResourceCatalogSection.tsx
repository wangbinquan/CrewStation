import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { ConfirmationPanel } from '../../../../shared/ui/ConfirmationPanel';
import { DataTable } from '../../../../shared/ui/DataTable';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { useResourceCatalogDraft } from '../../hooks/useResourceCatalogDraft';
import { useResourceCatalogWrite } from '../../hooks/useResourceCatalogWrite';
import type { ResourceCatalogKind } from '../../model/resourceCatalogDraft';
import { ResourceCatalogConfirmation } from './ResourceCatalogConfirmation';
import { ResourceCatalogForm } from './ResourceCatalogForm';
import styles from '../AdminForm.module.css';

/** 服务与任务资源各自调用原目录端点；只共用字段、草稿和确认交互。 */
export function ResourceCatalogSection({ kind }: { readonly kind: ResourceCatalogKind }) {
  const t = useT(), editor = useResourceCatalogDraft(kind), writer = useResourceCatalogWrite(kind, editor.load);
  const { query, save, busy, unavailable } = writer, prefix = kind === 'service' ? 'plans' : 'profiles';
  const items = query.data?.items ?? [], frozen = Boolean(writer.confirmation) || editor.replacement !== undefined;
  return <Card compact title={t(`admin.${prefix}.title`)} footer={t(`admin.${prefix}.hint`)} extra={<div className={styles.actions}>
    <Button disabled={busy || frozen} onClick={() => { writer.resetFeedback(); editor.requestLoad(); }}>{t('admin.resource.new', { kind: t(`admin.resource.${kind}`) })}</Button>
    <Button disabled={busy || query.isFetching} onClick={() => { void query.refetch(); }}>{t('admin.resource.refresh')}</Button>
  </div>}>
    <UnsavedChangesGuard dirty={editor.dirty || busy} scope={t(`admin.resource.${kind}`)} />
    <QueryStatus isPending={query.isPending} error={query.error} isEmpty={items.length === 0} emptyTitle={t(`admin.${prefix}.emptyTitle`)} emptyDescription={t(`admin.${prefix}.emptyDescription`)} />
    {items.length ? <DataTable columns={['name', 'cpu', 'memory', kind === 'service' ? 'maxReplicas' : 'storage', 'description'].map((field) => t(`admin.${prefix}.${field}`)).concat(t('admin.resource.actions'))}>{items.map((entry) => <tr key={entry.id}>
      <td>{entry.name}<br /><code>{entry.id}</code></td><td>{entry.cpu}</td><td>{entry.memory}</td><td>{'maxReplicas' in entry ? entry.maxReplicas : entry.storage}</td><td>{entry.description || t('admin.none')}</td>
      <td><Button disabled={busy || frozen || unavailable} onClick={() => { writer.resetFeedback(); editor.requestLoad(entry); }}>{t('admin.resource.edit')}</Button></td>
    </tr>)}</DataTable> : null}
    {editor.replacement !== undefined ? <ConfirmationPanel question={t('admin.resource.replaceQuestion', { name: editor.replacement?.name ?? t('admin.resource.emptyDraft') })} confirmLabel={t('admin.resource.replace')} cancelLabel={t('ui.draft.stay')} onConfirm={editor.replace} onCancel={editor.cancelReplacement} busy={busy} /> : null}
    <ResourceCatalogConfirmation kind={kind} writer={writer} />
    {writer.error ? <ActionNote tone="error">{writer.error}</ActionNote> : null}
    {busy ? <ActionNote tone="neutral">{t('admin.resource.pendingNote')}</ActionNote> : null}
    {save.isSuccess ? <ActionNote tone="success">{t('admin.resource.saved', { kind: t(`admin.resource.${kind}`), name: save.data.name })} {t(`admin.${prefix}.hint`)}</ActionNote> : null}
    <ResourceCatalogForm kind={kind} editor={editor} busy={busy} frozen={frozen} unavailable={unavailable} onPrepare={(input) => { void writer.prepare(input); }} onChange={writer.resetFeedback} />
  </Card>;
}
