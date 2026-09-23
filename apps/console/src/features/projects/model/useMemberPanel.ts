import type { MemberDto } from '@crewstation/contracts';
import { useCallback, useState } from 'react';

/**
 * 成员弹窗的开关与草稿（2026-09-23 起是弹窗）：关窗只收起，表单组件留着挂载，草稿一直保留到保存成功、清空或确认换成别的对象；
 * 再点同一个入口（「添加成员」或同一人的「修改角色」）恢复上次输入。换对象时有未保存输入要先确认。
 * `member`：undefined 没有草稿，null 是添加成员，其余是修改这个人的角色。
 */
export function useMemberPanel() {
  const [member, setMember] = useState<MemberDto | null>(), [sequence, setSequence] = useState(0), [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false), [next, setNext] = useState<{ member: MemberDto | null }>();
  const dirtyChanged = useCallback((value: boolean) => setDirty(value), []);
  const apply = (value?: MemberDto | null) => { setMember(value); setSequence((seq) => seq + 1); setDirty(false); setNext(undefined); setOpen(value !== undefined); };
  const same = (value: MemberDto | null) => member !== undefined && (value === null ? member === null : member?.userId === value.userId);
  return {
    member, sequence, open, next, dirtyChanged,
    select: (value: MemberDto | null) => { if (same(value)) setOpen(true); else if (dirty) setNext({ member: value }); else apply(value); },
    confirm: () => { if (next) apply(next.member); },
    /** 换对象时选了「继续编辑」：回到那份草稿的弹窗。 */
    keep: () => { setNext(undefined); setOpen(true); },
    /** ✕、取消、Esc：只关窗，草稿留着。 */
    hide: () => setOpen(false),
    /** 清空：同一个对象重新起一份表单。 */
    clear: () => { setSequence((seq) => seq + 1); setDirty(false); },
    /** 保存成功：丢掉草稿并关窗。 */
    close: () => apply(),
  };
}
