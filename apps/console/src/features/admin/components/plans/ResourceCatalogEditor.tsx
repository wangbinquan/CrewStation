import { useEffect } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { useResourceCatalogDraft } from '../../hooks/useResourceCatalogDraft';
import { useResourceCatalogWrite } from '../../hooks/useResourceCatalogWrite';
import type { ResourceCatalogEntry, ResourceCatalogKind } from '../../model/resourceCatalogDraft';
import { ResourceCatalogConfirmation } from './ResourceCatalogConfirmation';
import { ResourceCatalogForm } from './ResourceCatalogForm';

export function ResourceCatalogEditor({ kind, initial, open, onDirty, onClose, onSaved }: {
  readonly kind: ResourceCatalogKind; readonly initial?: ResourceCatalogEntry; readonly open: boolean;
  readonly onDirty: (dirty: boolean) => void; readonly onClose: () => void; readonly onSaved: (entry: ResourceCatalogEntry) => void;
}) {
  const t = useT(), editor = useResourceCatalogDraft(kind, initial);
  const writer = useResourceCatalogWrite(kind, (entry) => { editor.load(entry); onSaved(entry); });
  useEffect(() => onDirty(editor.dirty || writer.busy), [editor.dirty, writer.busy, onDirty]);
  return <><UnsavedChangesGuard dirty={editor.dirty || writer.busy} scope={t(`admin.resource.${kind}`)} />
    {open ? <ResourceCatalogForm kind={kind} editor={editor} busy={writer.busy} frozen={!!writer.confirmation} unavailable={writer.unavailable}
      onPrepare={(input) => { void writer.prepare(input); }} onChange={writer.resetFeedback} error={writer.error} onClose={onClose} onClear={() => editor.load(initial)} /> : null}
    <ResourceCatalogConfirmation kind={kind} writer={writer} />
  </>;
}
