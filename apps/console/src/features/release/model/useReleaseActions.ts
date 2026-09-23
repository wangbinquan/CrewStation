import { useCallback, useRef, useState } from 'react';

/** 页上的写操作：发布、切流、待命槽的下线／推迟／重新部署、正式版本维护（RFC-021）。同一时刻只进行一个。 */
type Action = 'publish' | 'traffic' | 'lifecycle' | 'maintenance';
/** 会留下未提交输入的弹窗：发布准备、切换说明、维护设置。 */
export type ReleaseDraft = 'publish' | 'traffic' | 'maintenance';
const DRAFTS: readonly ReleaseDraft[] = ['publish', 'traffic', 'maintenance'];

/**
 * 同一项目页的一份离开确认和写入互斥；几个弹窗的草稿分别保留。
 * 2026-09-23 起草稿都在页面上、关弹窗不丢，所以只有离开这一页（换路径）才进离开确认；进行中的发布另外挡住收起发布准备。
 */
export function useReleaseActions() {
  const owner = useRef<Action | null>(null), drafts = useRef<Record<ReleaseDraft, boolean>>({ publish: false, traffic: false, maintenance: false });
  const [busy, setBusy] = useState<Action | null>(null), [dirtyDrafts, setDirtyDrafts] = useState<readonly ReleaseDraft[]>([]);
  const markDraft = useCallback((draft: ReleaseDraft, value: boolean) => {
    if (drafts.current[draft] === value) return;
    drafts.current[draft] = value; setDirtyDrafts(DRAFTS.filter((name) => drafts.current[name]));
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
    // 同一页里换来源、选历史、收起发布准备都不丢草稿；只有发布请求在途时不能收起发布准备。
    return owner.current !== 'publish' || ('source' in next.search && !!next.search.source);
  }, []);
  return { busy, dirty: dirtyDrafts.length > 0, dirtyDrafts, begin, finish, markDraft, allowNavigate };
}
export type ReleaseActions = ReturnType<typeof useReleaseActions>;
