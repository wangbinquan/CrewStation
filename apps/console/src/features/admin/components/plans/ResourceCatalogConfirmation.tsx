import { useT } from '../../../../shared/lib/useT';
import { ConfirmationPanel } from '../../../../shared/ui/ConfirmationPanel';
import { DataTable } from '../../../../shared/ui/DataTable';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import type { useResourceCatalogWrite } from '../../hooks/useResourceCatalogWrite';
import type { ResourceCatalogField, ResourceCatalogKind } from '../../model/resourceCatalogDraft';
import { resourceCatalogDraft } from '../../model/resourceCatalogDraft';

export function ResourceCatalogConfirmation({ kind, writer }: { readonly kind: ResourceCatalogKind; readonly writer: ReturnType<typeof useResourceCatalogWrite> }) {
  const t = useT(), snapshot = writer.confirmation;
  if (!snapshot) return null;
  const before = resourceCatalogDraft(snapshot.before), after = resourceCatalogDraft(snapshot.input);
  const fields: readonly ResourceCatalogField[] = ['cpu', 'memory', kind === 'service' ? 'maxReplicas' : 'storage', 'description'];
  return <ConfirmationPanel question={t(snapshot.before ? 'admin.resource.overwriteQuestion' : 'admin.resource.createQuestion', { kind: t(`admin.resource.${kind}`), name: snapshot.input.name })} hint={t('admin.resource.confirmHint')} confirmLabel={t(snapshot.before ? 'admin.resource.confirmOverwrite' : 'admin.resource.confirmCreate')} cancelLabel={t('ui.draft.stay')} busy={writer.busy} confirmDisabled={writer.unavailable} onConfirm={() => { void writer.confirm(); }} onCancel={writer.cancel}>
    {writer.changed ? <ActionNote tone="neutral">{t('admin.resource.changed')}</ActionNote> : null}
    <DataTable columns={[t('admin.resource.field'), t('admin.resource.current'), t('admin.resource.next')]}>{fields.map((field) => <tr key={field}>
      <td>{t(`admin.${kind === 'service' ? 'plans' : 'profiles'}.${field}`)}</td><td>{snapshot.before ? before[field] || '—' : t('admin.resource.absent')}</td><td>{after[field] || '—'}</td>
    </tr>)}</DataTable>
    <p>{t(`admin.${kind === 'service' ? 'plans' : 'profiles'}.hint`)}</p>
  </ConfirmationPanel>;
}
