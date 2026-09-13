import type { MemberDto, SetMemberRequest } from '@crewstation/contracts';
import { useRef } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';

/** 同一成员清单只执行一项变更；刷新失败时保留表单，恢复后继续。 */
export function useMemberManagement(projectId: string) {
  const members = useApiQuery(queryKeys.members(projectId), () => api.projects.listMembers(projectId));
  const lock = useRef(false);
  const invalidate = [queryKeys.project(projectId), queryKeys.me(), ['market']];
  const save = useApiMutation((input: SetMemberRequest) => api.projects.setMember(projectId, input), { invalidate });
  const remove = useApiMutation(async (member: MemberDto) => { await api.projects.removeMember(projectId, member.userId); return member; }, { invalidate });
  const pending = save.isPending || remove.isPending;
  const unavailable = members.isPending || members.isError;
  const saveMember = async (input: SetMemberRequest) => {
    if (lock.current || unavailable) return undefined;
    lock.current = true; remove.reset();
    try { return await save.mutateAsync(input); } finally { lock.current = false; }
  };
  const removeMember = async (member: MemberDto) => {
    if (lock.current || unavailable) return;
    lock.current = true; save.reset();
    try { await remove.mutateAsync(member); } catch { /* 错误由清单中的 ActionNote 呈现。 */ }
    finally { lock.current = false; }
  };
  return { members, save, remove, pending, unavailable, saveMember, removeMember };
}
