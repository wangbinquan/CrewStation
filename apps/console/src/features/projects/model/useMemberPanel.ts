import type { MemberDto } from '@crewstation/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

/** 保留当前成员草稿直到用户确认切换目标，或服务端明确保存成功。 */
export function useMemberPanel() {
  const [member, setMember] = useState<MemberDto | null>(), [sequence, setSequence] = useState(0);
  const [dirty, setDirty] = useState(false), [next, setNext] = useState<{ member?: MemberDto | null }>();
  const opener = useRef<HTMLButtonElement | null>(null), confirmation = useRef<HTMLDivElement>(null);
  const dirtyChanged = useCallback((value: boolean) => setDirty(value), []);
  const apply = (value?: MemberDto | null) => { setMember(value); setSequence((seq) => seq + 1); setDirty(false); setNext(undefined); if (value === undefined) opener.current?.focus(); };
  const select = (value?: MemberDto | null, button?: HTMLButtonElement) => {
    if (member === undefined && button) opener.current = button;
    if (dirty) setNext({ member: value }); else apply(value);
  };
  useEffect(() => { if (next) confirmation.current?.querySelector<HTMLButtonElement>('button:last-child')?.focus(); }, [next]);
  return { member, sequence, next, confirmation, select, dirtyChanged, confirm: () => apply(next?.member), keep: () => setNext(undefined), close: () => apply() };
}
