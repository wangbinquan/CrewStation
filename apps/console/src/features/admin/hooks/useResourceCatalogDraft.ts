import { useState } from 'react';
import type { ResourceCatalogEntry, ResourceCatalogField, ResourceCatalogKind } from '../model/resourceCatalogDraft';
import { resourceCatalogDraft, resourceCatalogErrors, resourceCatalogInput } from '../model/resourceCatalogDraft';

export function useResourceCatalogDraft(kind: ResourceCatalogKind, initial?: ResourceCatalogEntry) {
  const [draft, setDraft] = useState(() => resourceCatalogDraft(initial)), [base, setBase] = useState(() => resourceCatalogDraft(initial));
  const [errors, setErrors] = useState<ReturnType<typeof resourceCatalogErrors>>({});
  const [replacement, setReplacement] = useState<ResourceCatalogEntry | null>();
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const load = (entry?: ResourceCatalogEntry) => { const value = resourceCatalogDraft(entry); setDraft(value); setBase(value); setErrors({}); };
  return {
    draft, dirty, errors, replacement, load,
    change: (field: ResourceCatalogField, value: string) => { setDraft((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: undefined })); },
    validate: () => {
      const found = resourceCatalogErrors(kind, draft); setErrors(found);
      return Object.keys(found).length ? undefined : resourceCatalogInput(kind, draft);
    },
    requestLoad: (entry?: ResourceCatalogEntry) => { if (dirty) setReplacement(entry ?? null); else load(entry); },
    cancelReplacement: () => setReplacement(undefined),
    replace: () => { if (replacement !== undefined) { load(replacement ?? undefined); setReplacement(undefined); } },
  };
}
