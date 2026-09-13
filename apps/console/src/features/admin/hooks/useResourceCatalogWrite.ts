import { useEffect, useRef, useState } from 'react';
import { errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { resourceCatalogAccess } from '../model/resourceCatalogAccess';
import type { ResourceCatalogEntry, ResourceCatalogKind } from '../model/resourceCatalogDraft';
import { sameResourceCatalogEntry } from '../model/resourceCatalogDraft';

interface ResourceConfirmation { readonly input: ResourceCatalogEntry; readonly before: ResourceCatalogEntry | undefined }

/** 既有目录是同名覆盖；重读与对照改善确认材料，不冒充服务端 CAS。 */
export function useResourceCatalogWrite(kind: ResourceCatalogKind, onSaved: (entry: ResourceCatalogEntry) => void) {
  const t = useT(), access = resourceCatalogAccess(kind, t('admin.resource.invalidRead'), t('admin.resource.invalidWrite'));
  const query = useApiQuery(access.key, access.read), save = useApiMutation(access.write, { invalidate: [access.key] });
  const lock = useRef(false), life = useRef(0);
  const [checking, setChecking] = useState(false), [confirmation, setConfirmation] = useState<ResourceConfirmation>();
  const [error, setError] = useState<string>(), [changed, setChanged] = useState(false);
  useEffect(() => { const generation = life.current + 1; life.current = generation; return () => { life.current = generation + 1; }; }, []);
  const unavailable = query.isPending || query.isError || query.isFetching, busy = checking || save.isPending;
  const current = async (name: string) => {
    const latest = await query.refetch();
    if (latest.error || !latest.data) throw latest.error ?? new Error(t('admin.resource.invalidRead'));
    return latest.data.items.find((entry) => entry.name === name);
  };
  const prepare = async (input: ResourceCatalogEntry) => {
    if (lock.current || unavailable) return;
    lock.current = true; setChecking(true); setError(undefined); setChanged(false); save.reset();
    const generation = life.current;
    try { const before = await current(input.name); if (generation === life.current) setConfirmation({ input, before }); }
    catch (failure) { if (generation === life.current) setError(errorMessage(failure)); }
    finally { lock.current = false; if (generation === life.current) setChecking(false); }
  };
  const confirm = async () => {
    if (lock.current || unavailable || !confirmation) return;
    lock.current = true; setChecking(true); setError(undefined);
    const generation = life.current, snapshot = confirmation;
    try {
      const before = await current(snapshot.input.name);
      if (generation !== life.current) return;
      if (!sameResourceCatalogEntry(before, snapshot.before)) { setConfirmation({ input: snapshot.input, before }); setChanged(true); return; }
      const result = await save.mutateAsync(snapshot.input);
      if (generation === life.current) { onSaved(result); setConfirmation(undefined); setChanged(false); }
    } catch (failure) { if (generation === life.current) setError(errorMessage(failure)); }
    finally { lock.current = false; if (generation === life.current) setChecking(false); }
  };
  return { query, save, busy, checking, unavailable, confirmation, error, changed, prepare, confirm,
    cancel: () => { if (!lock.current) { setConfirmation(undefined); setChanged(false); } },
    resetFeedback: () => { if (!lock.current) { save.reset(); setError(undefined); } },
  };
}
