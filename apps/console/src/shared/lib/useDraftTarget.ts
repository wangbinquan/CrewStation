import { useCallback, useState } from 'react';

/**
 * 弹窗表单的「编辑对象＋草稿」开关（2026-09-23 裁定：关窗不丢草稿）。表单组件以 `sequence` 为 key 常驻挂载（草稿在它的状态里），
 * 弹窗只在 `open` 时画出来：取消、✕、Esc 只收起；再点同一个对象恢复上次输入；有未保存输入时改去编辑别的对象先确认（`next`），
 * 「继续编辑」回到原来那份；「清空」让同一个对象重挂一份表单；保存成功才丢草稿。`same` 判断两次点的是不是同一个对象。
 */
export function useDraftTarget<T>(same: (current: T, next: T) => boolean) {
  const [target, setTarget] = useState<{ readonly value: T }>(), [sequence, setSequence] = useState(0), [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false), [next, setNext] = useState<{ readonly value: T }>();
  const dirtyChanged = useCallback((value: boolean) => setDirty(value), []);
  const apply = (value?: { readonly value: T }) => { setTarget(value); setSequence((seq) => seq + 1); setDirty(false); setNext(undefined); setOpen(value !== undefined); };
  return {
    /** 有草稿时的编辑对象；没有草稿时 hasDraft 为 false。 */
    target: target?.value, hasDraft: target !== undefined, sequence, open, dirty,
    /** 等待确认的下一个对象：有值时该显示「放弃未保存的输入并改编辑它？」的确认。 */
    next: next?.value, switching: next !== undefined, dirtyChanged,
    select: (value: T) => { if (target && same(target.value, value)) setOpen(true); else if (dirty) setNext({ value }); else apply({ value }); },
    confirm: () => { if (next) apply(next); },
    /** 换对象时选了「继续编辑」：回到原来那份草稿的弹窗。 */
    keep: () => { setNext(undefined); setOpen(true); },
    hide: () => setOpen(false),
    clear: () => { setSequence((seq) => seq + 1); setDirty(false); },
    /** 保存成功：丢掉草稿并关窗。 */
    close: () => apply(),
  };
}
export type DraftTarget<T> = ReturnType<typeof useDraftTarget<T>>;
