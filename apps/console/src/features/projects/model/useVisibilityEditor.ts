import type { AppVisibilityDto, MemberCandidateDto, SetAppVisibilityRequest } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { useApiMutation } from '../../../shared/api/useApi';

export function useVisibilityEditor(projectId: string, saved: AppVisibilityDto, reload: () => Promise<unknown>, canSave: boolean, onSaved?: () => void) {
  const [draft, setDraft] = useState(saved), [base, setBase] = useState(saved), [invalid, setInvalid] = useState(false);
  const lock = useRef(false);
  const dirty = draft.mode !== base.mode || JSON.stringify(draft.userIds) !== JSON.stringify(base.userIds);
  const save = useApiMutation((input: SetAppVisibilityRequest) => api.projects.setAppVisibility(projectId, input), {
    invalidate: [['market']], onSuccess: (value) => { setDraft(value); setBase(value); void reload(); onSaved?.(); },
  });
  if (!dirty && !save.isPending && saved.revision > base.revision) { setDraft(saved); setBase(saved); }
  const conflict = saved.revision > base.revision;
  /** `root`：表单字段所在的元素，校验失败时把焦点放回出错的输入。 */
  const submit = (root: ParentNode) => {
    if (!canSave || conflict || lock.current) return;
    const userIds = draft.mode === 'selected' ? draft.userIds : [];
    if (draft.mode === 'selected' && userIds.length === 0) { setInvalid(true); root.querySelector('input')?.focus(); return; }
    setInvalid(false); lock.current = true;
    void save.mutateAsync({ mode: draft.mode, userIds, expectedRevision: base.revision }).catch(() => { void reload(); }).finally(() => { lock.current = false; });
  };
  const add = (user: MemberCandidateDto) => {
    if (lock.current || draft.userIds.length >= 200) return;
    setInvalid(false); save.reset();
    setDraft((previous) => previous.userIds.includes(user.userId) ? previous : { ...previous, userIds: [...previous.userIds, user.userId], users: [...previous.users, user] });
  };
  return {
    draft, dirty, invalid, save, submit, add, conflict,
    canSubmit: canSave && !conflict && !save.isPending,
    canRebase: canSave && !save.isPending,
    select: (mode: AppVisibilityDto['mode']) => { setDraft({ ...draft, mode }); setInvalid(false); save.reset(); },
    remove: (userId: string) => { setDraft({ ...draft, userIds: draft.userIds.filter((id) => id !== userId), users: draft.users.filter((user) => user.userId !== userId) }); save.reset(); },
    cancel: () => { if (!lock.current) { setDraft(saved); setBase(saved); setInvalid(false); save.reset(); } },
    rebaseDraft: () => { if (canSave && !lock.current) { setBase({ ...saved, mode: base.mode, userIds: base.userIds }); save.reset(); } },
  };
}
