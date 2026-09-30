import type { ProjectDto } from '@crewstation/contracts';
import { ProjectPageSchema, UserIdSchema } from '@crewstation/contracts';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { isApiClientError, useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import type { CreationErrors, CreationField, CreationScope } from '../model/creationDraft';
import { confirmedCreationResult, creationErrors, creationInput, creationServerErrors } from '../model/creationDraft';
import { useCreationCatalog, useCreationDraft } from './useCreationCatalog';

export function useProjectCreation(scope: CreationScope, onCreated: (project: ProjectDto) => void, open: boolean, self: boolean) {
  const t = useT(), busy = useRef(false);
  const data = useCreationCatalog(scope, self, open);
  const { draft, setEdits, resetDraft } = useCreationDraft(data.defaults);
  const [errors, setErrors] = useState<CreationErrors>({});
  const [unknown, setUnknown] = useState(false), [reconciling, setReconciling] = useState(false), [resultError, setResultError] = useState<string>();
  const epoch = useRef(0);
  useEffect(() => { const value = ++epoch.current; return () => { epoch.current = value + 1; }; }, []);
  const create = useApiMutation((input: ReturnType<typeof creationInput>) => api.projects.create(input), { invalidate: [queryKeys.projects(), queryKeys.me()] });
  const clear = () => { if (busy.current || unknown) return; resetDraft(); setErrors({}); create.reset(); setResultError(undefined); };
  const dirty = !!draft.name || !!draft.slug || draft.ownerUserId !== data.defaults(draft.kind).ownerUserId ||
    draft.kind !== data.defaults().kind || draft.template !== data.defaults(draft.kind).template || draft.plan !== data.defaults().plan || !!draft.maxConcurrentTasks;
  const accept = (project: ProjectDto) => { resetDraft(); setErrors({}); create.reset(); setUnknown(false); setResultError(undefined); onCreated(project); };
  const expected = () => ({ ...creationInput(draft, data.catalog, self), ownerUserId: UserIdSchema.parse(draft.ownerUserId) });
  const reconcile = async () => {
    if (busy.current || !unknown) return;
    busy.current = true; setReconciling(true); const generation = epoch.current;
    try {
      let cursor: string | undefined; const seen = new Set<string>();
      do {
        const page = ProjectPageSchema.parse(await api.projects.page({ q: draft.slug.trim(), limit: 50, cursor }));
        const found = page.items.map((item) => confirmedCreationResult(item.project, expected())).find(Boolean);
        if (epoch.current !== generation) return;
        if (found) { accept(found); return; }
        cursor = page.nextCursor; if (cursor && seen.has(cursor)) throw new Error(t('projects.wizard.resultUnknown')); if (cursor) seen.add(cursor);
      } while (cursor);
      setUnknown(false); setResultError(undefined);
    } catch { if (epoch.current === generation) setResultError(t('projects.wizard.resultUnknown')); }
    finally { busy.current = false; setReconciling(false); }
  };
  const submit = async () => {
    if (busy.current || !data.available || unknown) return;
    const local = creationErrors(draft, scope, data.catalog, 2, self);
    setErrors(Object.fromEntries(Object.entries(local).map(([field, key]) => [field, t(`projects.wizard.${key}`)])));
    if (Object.keys(local).length) return;
    busy.current = true; setResultError(undefined); const generation = epoch.current;
    try {
      const result = await create.mutateAsync(creationInput(draft, data.catalog, self));
      if (epoch.current !== generation) return;
      const confirmed = confirmedCreationResult(result, expected());
      if (confirmed) accept(confirmed); else setUnknown(true);
    } catch (error) {
      if (epoch.current !== generation) return;
      setErrors(creationServerErrors(error));
      if (isApiClientError(error) && (error.status === 0 || error.status >= 500) && error.details.requestSent !== false) setUnknown(true);
    } finally { busy.current = false; }
  };
  const setField = (field: CreationField, value: string) => {
    if (busy.current || unknown) return;
    setEdits((current) => {
      if (field === 'kind') { const { template: _template, ...rest } = current; return { ...rest, kind: value as typeof draft.kind }; }
      return { ...current, [field]: value };
    });
    setErrors((current) => ({ ...current, [field]: undefined })); create.reset(); setResultError(undefined);
  };
  return { ...data, draft, errors, dirty, unknown, reconciling, resultError, create, clear, setField, submit, reconcile };
}
