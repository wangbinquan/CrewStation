import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ComputeProfileDetailDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { isApiClientError, useApiMutation } from '../../../shared/api/useApi';
import type { ProfileDraft } from '../model/profileDraft';
import { draftFromDetail, toCreateRequest, toSaveRequest } from '../model/profileDraft';
import type { ProfileDraftHandle } from './useProfileDraft';

/** 409 时服务端给出当前修订号；两种写法都接受（currentRevision 或 revision）。 */
function conflictRevision(error: unknown): number | undefined {
  if (!isApiClientError(error) || error.kind !== 'conflict') return undefined;
  const value = error.details.currentRevision ?? error.details.revision;
  return typeof value === 'number' ? value : undefined;
}

export type SaveNote = { kind: 'revision'; revision: number } | { kind: 'description' };

/**
 * 保存：新建走 create，编辑走 save 并带 expectedRevision；冲突保留草稿并给出当前修订。
 * 新建成功后等草稿归零（不再算未保存）才跳到编辑页，免得离开保护把自己拦下来。
 */
export function useProfileSave(detail: ComputeProfileDetailDto | undefined, editor: ProfileDraftHandle, onCreated: (name: string) => void) {
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<number | undefined>(undefined);
  const [note, setNote] = useState<SaveNote | undefined>(undefined);
  const [created, setCreated] = useState<string | undefined>(undefined);
  const adopt = (next: ComputeProfileDetailDto) => { queryClient.setQueryData(queryKeys.adminComputeProfile(next.name), next); editor.reload(draftFromDetail(next), next.revision); setConflict(undefined); };
  const save = useApiMutation((draft: ProfileDraft) => (detail === undefined ? api.computeProfiles.create(toCreateRequest(draft)) : api.computeProfiles.save(detail.name, toSaveRequest(draft, editor.baseRevision ?? detail.revision))), {
    invalidate: [queryKeys.computeProfiles()],
    onSuccess: (next) => {
      // P3：只改说明时服务端不生成新修订，也不重测。
      setNote(detail !== undefined && next.revision === (editor.baseRevision ?? detail.revision) ? { kind: 'description' } : { kind: 'revision', revision: next.revision });
      adopt(next);
      if (detail === undefined) setCreated(next.name);
    },
  });
  // 放弃修改或按当前修订重存时，上一次保存的 409 已经处理过，不再显示成「保存失败」。
  const reload = useApiMutation(() => api.computeProfiles.get(detail!.name), { onSuccess: (next) => { save.reset(); adopt(next); } });
  // 保存中也算未保存（离开保护会拦）：等 mutation 落定、草稿归零后再跳。
  useEffect(() => { if (created !== undefined && !editor.dirty && !save.isPending) onCreated(created); }, [created, editor.dirty, save.isPending, onCreated]);
  const submit = () => {
    setNote(undefined);
    if (!editor.validate(detail === undefined)) return;
    save.mutateAsync(editor.draft).catch((error: unknown) => { const current = conflictRevision(error); if (current !== undefined) setConflict(current); });
  };
  return { save, reload, submit, conflict, clearConflict: () => { setConflict(undefined); save.reset(); }, note, busy: save.isPending || reload.isPending };
}
