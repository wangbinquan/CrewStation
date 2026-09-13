import type { AppIcon, AppPresentationDto, SetAppPresentationRequest } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { useApiMutation } from '../../../shared/api/useApi';

export function usePresentationEditor(projectId: string, saved: AppPresentationDto, reload: () => Promise<unknown>, canSave: boolean) {
  const [draft, setDraft] = useState(saved), [base, setBase] = useState(saved), [invalid, setInvalid] = useState(false);
  const lock = useRef(false);
  const dirty = draft.description !== base.description || draft.icon !== base.icon;
  const save = useApiMutation((input: SetAppPresentationRequest) => api.projects.setAppPresentation(projectId, input), {
    invalidate: [['market']], onSuccess: (value) => { setDraft(value); setBase(value); void reload(); },
  });
  if (!dirty && !save.isPending && saved.revision > base.revision) { setDraft(saved); setBase(saved); }
  const conflict = saved.revision > base.revision;
  const submit = (form: HTMLFormElement) => {
    if (!canSave || conflict || lock.current) return;
    if (draft.description.trim().length > 400) { setInvalid(true); form.querySelector('textarea')?.focus(); return; }
    setInvalid(false); lock.current = true;
    void save.mutateAsync({ description: draft.description, icon: draft.icon, expectedRevision: base.revision }).catch(() => { void reload(); }).finally(() => { lock.current = false; });
  };
  return {
    draft, dirty, invalid, save, submit, conflict,
    canSubmit: canSave && !conflict && !save.isPending,
    canRebase: canSave && !save.isPending,
    describe: (description: string) => { setDraft({ ...draft, description }); save.reset(); setInvalid(false); },
    chooseIcon: (icon: AppIcon) => { setDraft({ ...draft, icon }); save.reset(); },
    cancel: () => { if (!lock.current) { setDraft(saved); setBase(saved); setInvalid(false); save.reset(); } },
    rebaseDraft: () => { if (canSave && !lock.current) { setBase({ ...base, revision: saved.revision }); save.reset(); } },
  };
}
