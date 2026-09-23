import { useEffect, useState } from 'react';
import type { ReleaseActions } from './useReleaseActions';

/** 发布准备里用户填的三项：分支（空串表示默认分支）、版本号（默认按补丁位递增）与说明。 */
export interface PublishDraftValues {
  readonly branch: string;
  readonly version: string;
  readonly message: string;
}

const EMPTY: PublishDraftValues = { branch: '', version: 'patch', message: '' };

/**
 * 发布准备的草稿放在发布页上，不在弹窗里（2026-09-23 裁定）：关掉弹窗再打开恢复上次输入，换来源、返回步骤也不丢；
 * 发布受理或「清空」才回到初始值。改过就进页面的离开确认。
 */
export function usePublishDraft(actions: ReleaseActions) {
  const [values, setValues] = useState<PublishDraftValues>(EMPTY);
  const dirty = values.branch !== EMPTY.branch || values.version !== EMPTY.version || values.message !== EMPTY.message, { markDraft } = actions;
  useEffect(() => { markDraft('publish', dirty); }, [dirty, markDraft]);
  useEffect(() => () => markDraft('publish', false), [markDraft]);
  return {
    values, dirty,
    set: (patch: Partial<PublishDraftValues>) => setValues((previous) => ({ ...previous, ...patch })),
    reset: () => setValues(EMPTY),
  };
}
export type PublishDraft = ReturnType<typeof usePublishDraft>;
