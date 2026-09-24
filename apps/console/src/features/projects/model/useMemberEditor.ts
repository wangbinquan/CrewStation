import { UserIdSchema } from '@crewstation/contracts';
import type { MemberCandidateDto, MemberDto, MemberRole, SetMemberRequest } from '@crewstation/contracts';
import { useState } from 'react';
import { useT } from '../../../shared/lib/useT';

export type MemberTargetMode = 'lookup' | 'id' | 'directory';
export interface MemberEditorOptions {
  readonly projectId: string;
  readonly initialMember?: MemberDto;
  readonly isAdmin: boolean;
  readonly canManage: boolean;
  readonly members: readonly MemberDto[];
  readonly pending: boolean;
  readonly disabled: boolean;
  readonly onSave: (input: SetMemberRequest) => Promise<MemberDto | undefined>;
}

/** 查找文字与 ID 都保留；未选中查找结果时不能偷偷提交另一模式的旧 ID。 */
export function useMemberEditor({ isAdmin, canManage, members, pending, disabled, onSave, initialMember }: MemberEditorOptions) {
  const t = useT();
  const [user, setUser] = useState<MemberCandidateDto | undefined>(initialMember), [rawId, setRawId] = useState(''), [identity, setIdentity] = useState('');
  const [mode, setMode] = useState<MemberTargetMode>('lookup'), [role, setRole] = useState<MemberRole>(initialMember?.role ?? 'developer');
  const [error, setError] = useState<string>(), [confirmedInput, setConfirmedInput] = useState<SetMemberRequest>();
  const [pickerKey, setPickerKey] = useState(0);
  const targetId = user?.userId ?? (mode === 'id' ? rawId.trim() : ''), current = members.find((member) => member.userId === targetId);
  const currentOwner = members.find((member) => member.role === 'owner');
  const locked = disabled || !canManage || pending || Boolean(confirmedInput);
  const dirty = user?.userId !== initialMember?.userId || Boolean(rawId || identity || role !== (initialMember?.role ?? 'developer') || confirmedInput);
  const save = async (input: SetMemberRequest) => {
    if (disabled || !canManage || pending || (input.role === 'owner' && !isAdmin)) return;
    try {
      if (await onSave(input)) {
        setUser(undefined); setRawId(''); setIdentity(''); setRole('developer'); setMode('lookup');
        setPickerKey((value) => value + 1); setConfirmedInput(undefined); setError(undefined);
      }
    } catch { /* 失败保留目标、角色与确认内容，清单展示真实错误。 */ }
  };
  const select = (value: MemberCandidateDto | undefined) => {
    setUser(value); setRawId(''); setError(undefined);
    setRole(value?.platformRole === 'user' ? 'tester' : members.find((member) => member.userId === value?.userId)?.role ?? 'developer');
  };
  /** `root`：表单字段所在的元素，目标没选时把焦点放回第一个可用输入。 */
  function submit(root: ParentNode | null) {
    if (locked) return;
    const parsed = UserIdSchema.safeParse(targetId);
    if (!parsed.success) { setError(t('projects.members.targetRequired')); root?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled)')?.focus(); return; }
    if ((role === 'owner' && !isAdmin) || (current?.role === 'owner' && role !== 'owner')) return;
    // 平台普通用户只能是测试者或「用户」（2026-09-24 起多了「用户」：只用正式版）。
    if ((role === 'owner' || role === 'developer') && user?.platformRole === 'user') { setError(t('projects.members.developerRequired')); return; }
    setError(undefined); const input = { userId: parsed.data, role };
    if (role === 'owner' && current?.role !== 'owner') setConfirmedInput(input);
    else void save(input);
  }
  return {
    user, rawId, identity, mode, role, error, confirmedInput, pickerKey, targetId, current, currentOwner, locked, dirty, submit, save, select,
    setRole, cancelTransfer: () => setConfirmedInput(undefined),
    changeIdentity: (value: string) => { setIdentity(value); setError(undefined); },
    changeRawId: (value: string) => { setRawId(value); setError(undefined); },
    changeMode: (value: MemberTargetMode) => { setMode(value); setError(undefined); },
  };
}
