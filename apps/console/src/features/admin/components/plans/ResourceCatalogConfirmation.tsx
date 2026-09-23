import { useT } from '../../../../shared/lib/useT';
import { DataTable } from '../../../../shared/ui/DataTable';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { ConfirmationDialog } from '../../../../shared/ui/dialog/ConfirmationDialog';
import type { useResourceCatalogWrite } from '../../hooks/useResourceCatalogWrite';
import type { ResourceCatalogField, ResourceCatalogKind } from '../../model/resourceCatalogDraft';
import { resourceCatalogDraft } from '../../model/resourceCatalogDraft';

/** 保存前的核对弹窗：逐字段列出目录当前值与本次保存值；目录在核对期间变了会标出来，要重新核对后再确认。 */
export function ResourceCatalogConfirmation({ kind, writer }: { readonly kind: ResourceCatalogKind; readonly writer: ReturnType<typeof useResourceCatalogWrite> }) {
  const t = useT(), snapshot = writer.confirmation;
  if (!snapshot) return null;
  const before = resourceCatalogDraft(snapshot.before), after = resourceCatalogDraft(snapshot.input);
  const fields: readonly ResourceCatalogField[] = ['name', 'cpu', 'memory', kind === 'service' ? 'maxReplicas' : 'storage', 'description'];
  return <ConfirmationDialog size="medium" question={t(snapshot.before ? 'admin.resource.overwriteQuestion' : 'admin.resource.createQuestion', { kind: t(`admin.resource.${kind}`), name: snapshot.input.name })} hint={t('admin.resource.confirmHint')} confirmLabel={t(snapshot.before ? 'admin.resource.confirmOverwrite' : 'admin.resource.confirmCreate')} cancelLabel={t('ui.draft.stay')} busy={writer.busy} confirmDisabled={writer.unavailable} onConfirm={() => { void writer.confirm(); }} onCancel={writer.cancel}>
    {writer.changed ? <ActionNote tone="neutral">{t('admin.resource.changed')}</ActionNote> : null}
    <DataTable columns={[t('admin.resource.field'), t('admin.resource.current'), t('admin.resource.next')]}>{fields.map((field) => <tr key={field}>
      <td>{t(`admin.${kind === 'service' ? 'plans' : 'profiles'}.${field}`)}</td><td>{snapshot.before ? before[field] || '—' : t('admin.resource.absent')}</td><td>{after[field] || '—'}</td>
    </tr>)}</DataTable>
    <p>{t(`admin.${kind === 'service' ? 'plans' : 'profiles'}.hint`)}</p>
  </ConfirmationDialog>;
}
