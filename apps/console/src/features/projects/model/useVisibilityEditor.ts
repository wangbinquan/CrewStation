import type { AppVisibilityDto, MemberCandidateDto, SetAppVisibilityRequest } from '@crewstation/contracts';
import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { useApiMutation } from '../../../shared/api/useApi';

export function useVisibilityEditor(projectId: string, saved: AppVisibilityDto, reload: () => Promise<unknown>) {
  const [draft, setDraft] = useState(saved), [base, setBase] = useState(saved), [invalid, setInvalid] = useState(false);
  const dirty = draft.mode !== base.mode || JSON.stringify(draft.userIds) !== JSON.stringify(base.userIds);
  if (!dirty && saved.revision > base.revision) { setDraft(saved); setBase(saved); }
  const save = useApiMutation((input: SetAppVisibilityRequest) => api.projects.setAppVisibility(projectId, input), {
    invalidate: [['market']], onSuccess: (value) => { setDraft(value); setBase(value); void reload(); },
  });
  const submit = () => {
    const userIds = draft.mode === 'selected' ? draft.userIds : [];
    if (draft.mode === 'selected' && userIds.length === 0) { setInvalid(true); return; }
    setInvalid(false);
    save.mutate({ mode: draft.mode, userIds, expectedRevision: base.revision }, { onError: () => { void reload(); } });
  };
  const add = (user: MemberCandidateDto) => {
    setInvalid(false); save.reset();
    setDraft((previous) => previous.userIds.includes(user.userId) ? previous : { ...previous, userIds: [...previous.userIds, user.userId], users: [...previous.users, user] });
  };
  return {
    draft, dirty, invalid, save, submit, add,
    conflict: saved.revision > base.revision,
    select: (mode: AppVisibilityDto['mode']) => { setDraft({ ...draft, mode }); setInvalid(false); save.reset(); },
    remove: (userId: string) => { setDraft({ ...draft, userIds: draft.userIds.filter((id) => id !== userId), users: draft.users.filter((user) => user.userId !== userId) }); save.reset(); },
    cancel: () => { setDraft(saved); setBase(saved); setInvalid(false); save.reset(); },
    rebaseDraft: () => { setBase({ ...saved, mode: base.mode, userIds: base.userIds }); save.reset(); },
  };
}
