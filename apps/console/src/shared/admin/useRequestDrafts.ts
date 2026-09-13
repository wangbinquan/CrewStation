import { useCallback, useEffect, useState } from 'react';

export interface RequestDraft { readonly id: string; readonly label: string; readonly value: string }

/** 意见属于申请 ID；当前页变化不会把它交给下一行，提交只清除原样的那份意见。 */
export function useRequestDrafts(busy: boolean, onDirtyChange: (dirty: boolean) => void) {
  const [values, setValues] = useState<Readonly<Record<string, RequestDraft>>>({});
  const dirty = busy || Object.keys(values).length > 0;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const change = useCallback((id: string, label: string, value: string) => setValues((previous) => {
    const next = { ...previous }; if (value.length > 0) next[id] = { id, label, value }; else delete next[id]; return next;
  }), []);
  const discard = useCallback((id: string, expected?: string) => setValues((previous) => {
    if (expected !== undefined && (previous[id]?.value ?? '') !== expected) return previous;
    const next = { ...previous }; delete next[id]; return next;
  }), []);
  return { entries: Object.values(values), read: (id: string) => values[id]?.value ?? '', change, discard };
}
