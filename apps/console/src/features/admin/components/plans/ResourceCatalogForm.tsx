import { useEffect, useRef } from 'react';
import { useT } from '../../../../shared/lib/useT';
import type { useResourceCatalogDraft } from '../../hooks/useResourceCatalogDraft';
import type { ResourceCatalogEntry, ResourceCatalogField, ResourceCatalogKind } from '../../model/resourceCatalogDraft';
import { AdminField } from '../AdminField';
import { AdminForm } from '../AdminForm';

interface ResourceFormProps {
  readonly kind: ResourceCatalogKind;
  readonly editor: ReturnType<typeof useResourceCatalogDraft>;
  readonly busy: boolean;
  readonly frozen: boolean;
  readonly unavailable: boolean;
  readonly onPrepare: (input: ResourceCatalogEntry) => void;
  readonly onChange: () => void;
}

export function ResourceCatalogForm({ kind, editor, busy, frozen, unavailable, onPrepare, onChange }: ResourceFormProps) {
  const t = useT(), root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }, [editor.errors]);
  const fields: readonly ResourceCatalogField[] = ['name', 'cpu', 'memory', kind === 'service' ? 'maxReplicas' : 'storage', 'description'];
  return <div ref={root}><AdminForm submitLabel={t('admin.resource.prepare')} busyLabel={t('admin.resource.busy')} busy={busy} incomplete={frozen || unavailable} onSubmit={() => {
    if (busy || frozen || unavailable) return;
    const input = editor.validate(); if (input) onPrepare(input);
  }}>
    {fields.map((field) => <AdminField key={field} label={t(`admin.${kind === 'service' ? 'plans' : 'profiles'}.${field}`)} value={editor.draft[field]} disabled={busy || frozen} inputMode={field === 'maxReplicas' ? 'numeric' : undefined} hint={t(`admin.resource.hint.${field}`)} error={editor.errors[field] ? t(`admin.resource.${editor.errors[field]}`) : undefined} onChange={(value) => { editor.change(field, value); onChange(); }} />)}
  </AdminForm></div>;
}
