import { useCallback, useRef, useState } from 'react';

/** 页上的写操作：发布、切流、待命槽的下线／推迟／重新部署、正式版本维护（RFC-021）。同一时刻只进行一个。 */
type Action = 'publish' | 'traffic' | 'lifecycle' | 'maintenance';
/** 会留下未提交输入的行内表单。 */
type Draft = 'publish' | 'traffic' | 'maintenance';

/** 同一项目页的一份离开确认和写入互斥；几个行内表单的草稿分别保留。 */
export function useReleaseActions() {
  const owner = useRef<Action | null>(null), drafts = useRef<Record<Draft, boolean>>({ publish: false, traffic: false, maintenance: false });
  const [busy, setBusy] = useState<Action | null>(null), [dirty, setDirty] = useState(false);
  const markDraft = useCallback((draft: Draft, value: boolean) => {
    drafts.current[draft] = value; setDirty(Object.values(drafts.current).some(Boolean));
  }, []);
  const begin = useCallback((action: Action) => {
    if (owner.current) return false; owner.current = action; setBusy(action); return true;
  }, []);
  const finish = useCallback((action: Action) => {
    if (owner.current !== action) return; owner.current = null; setBusy(null);
  }, []);
  const allowNavigate = useCallback((current: { pathname: string }, next: { pathname: string; search: object }) => {
    if (!Object.values(drafts.current).some(Boolean) && !owner.current) return true;
    if (current.pathname !== next.pathname) return false;
    // 发布来源与选中历史变化不卸载表单；收起准备只可能丢失发布草稿（维护表单与切流说明不随查询参数卸载）。
    return ('source' in next.search && !!next.search.source) || (!drafts.current.publish && owner.current !== 'publish');
  }, []);
  return { busy, dirty, begin, finish, markDraft, allowNavigate };
}
export type ReleaseActions = ReturnType<typeof useReleaseActions>;
