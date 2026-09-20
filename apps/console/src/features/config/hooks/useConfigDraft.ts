import type { ConfigEnv } from '@crewstation/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConfigItemDraft } from '../components/ConfigItemForm';

/** 每个环境拥有自己的编辑器，载入另一项或取消都先保护当前草稿。 */
export function useConfigDraft(env: ConfigEnv, onDirtyChange: (env: ConfigEnv, dirty: boolean) => void) {
  const [draft, setDraft] = useState<ConfigItemDraft>(), [sequence, setSequence] = useState(0);
  const [dirty, setDirty] = useState(false), [next, setNext] = useState<{ draft?: ConfigItemDraft }>();
  const trigger = useRef<HTMLButtonElement | null>(null), confirmation = useRef<HTMLDivElement>(null);
  const dirtyChanged = useCallback((value: boolean) => { setDirty(value); onDirtyChange(env, value); }, [env, onDirtyChange]);
  const apply = (value?: ConfigItemDraft) => { setDraft(value); setSequence((seq) => seq + 1); setNext(undefined); if (!value) trigger.current?.focus(); };
  const select = (value?: ConfigItemDraft, button?: HTMLButtonElement) => {
    if (button && !draft) trigger.current = button;
    if (dirty) setNext({ draft: value }); else apply(value);
  };
  useEffect(() => { if (next) confirmation.current?.querySelector<HTMLButtonElement>('button:last-child')?.focus(); }, [next]);
  return { draft, sequence, next, confirmation, dirtyChanged, select, complete: () => apply(), confirm: () => apply(next?.draft), keep: () => setNext(undefined) };
}
