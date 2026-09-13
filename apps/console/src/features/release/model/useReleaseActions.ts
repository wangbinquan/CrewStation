import { useCallback, useRef, useState } from 'react';

type Action = 'publish' | 'traffic';
/** 同一项目页的一份离开确认和写入互斥；两个行内表单的草稿分别保留。 */
export function useReleaseActions() {
  const owner = useRef<Action | null>(null), drafts = useRef({ publish: false, traffic: false });
  const [busy, setBusy] = useState<Action | null>(null), [dirty, setDirty] = useState(false);
  const markDraft = useCallback((action: Action, value: boolean) => {
    drafts.current[action] = value; setDirty(drafts.current.publish || drafts.current.traffic);
  }, []);
  const begin = useCallback((action: Action) => {
    if (owner.current) return false; owner.current = action; setBusy(action); return true;
  }, []);
  const finish = useCallback((action: Action) => {
    if (owner.current !== action) return; owner.current = null; setBusy(null);
  }, []);
  const allowNavigate = useCallback((current: { pathname: string }, next: { pathname: string; search: object }) => {
    if (!drafts.current.publish && !drafts.current.traffic && !owner.current) return true;
    if (current.pathname !== next.pathname) return false;
    // 发布来源与选中历史变化不卸载表单；收起准备只可能丢失发布草稿。
    return ('source' in next.search && !!next.search.source) || (!drafts.current.publish && owner.current !== 'publish');
  }, []);
  return { busy, dirty, begin, finish, markDraft, allowNavigate };
}
export type ReleaseActions = ReturnType<typeof useReleaseActions>;
