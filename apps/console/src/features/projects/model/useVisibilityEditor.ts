import type { AppVisibilityDto, SetAppVisibilityRequest } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { useApiMutation } from '../../../shared/api/useApi';

/** 可见范围与申请开关的草稿（2026-09-24 起两档范围，加「允许申请／只能授权」）；弹窗只是视图，草稿在这一层。 */
export function useVisibilityEditor(projectId: string, saved: AppVisibilityDto, reload: () => Promise<unknown>, canSave: boolean, onSaved?: () => void) {
  const [draft, setDraft] = useState(saved), [base, setBase] = useState(saved);
  const lock = useRef(false);
  const dirty = draft.mode !== base.mode || draft.allowRequests !== base.allowRequests;
  const save = useApiMutation((input: SetAppVisibilityRequest) => api.projects.setAppVisibility(projectId, input), {
    invalidate: [['market']], onSuccess: (value) => { setDraft(value); setBase(value); void reload(); onSaved?.(); },
  });
  if (!dirty && !save.isPending && saved.revision > base.revision) { setDraft(saved); setBase(saved); }
  const conflict = saved.revision > base.revision;
  const submit = () => {
    if (!canSave || conflict || lock.current) return;
    lock.current = true;
    void save.mutateAsync({ mode: draft.mode, allowRequests: draft.allowRequests, expectedRevision: base.revision }).catch(() => { void reload(); }).finally(() => { lock.current = false; });
  };
  return {
    draft, dirty, save, submit, conflict,
    canSubmit: canSave && !conflict && !save.isPending,
    canRebase: canSave && !save.isPending,
    select: (mode: AppVisibilityDto['mode']) => { setDraft({ ...draft, mode }); save.reset(); },
    allowRequests: (allowRequests: boolean) => { setDraft({ ...draft, allowRequests }); save.reset(); },
    cancel: () => { if (!lock.current) { setDraft(saved); setBase(saved); save.reset(); } },
    rebaseDraft: () => { if (canSave && !lock.current) { setBase({ ...saved, mode: base.mode, allowRequests: base.allowRequests }); save.reset(); } },
  };
}
