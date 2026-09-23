import type { ConfigEnv } from '@crewstation/contracts';
import { useCallback } from 'react';
import { useDraftTarget } from '../../../shared/lib/useDraftTarget';
import type { ConfigItemDraft } from '../components/ConfigItemForm';

/**
 * 每个环境一份草稿，在弹窗里编辑（2026-09-23 起）：取消、✕、Esc 只收起，再点同一项（或再点「新增变量」）恢复；
 * 有未保存输入时改编辑另一项先确认；保存成功才丢。改过的草稿报给页面的离开确认。
 */
export function useConfigDraft(env: ConfigEnv, onDirtyChange: (env: ConfigEnv, dirty: boolean) => void) {
  const panel = useDraftTarget<ConfigItemDraft>((current, next) => current.id === next.id), { dirtyChanged: setDirty } = panel;
  const dirtyChanged = useCallback((value: boolean) => { setDirty(value); onDirtyChange(env, value); }, [setDirty, env, onDirtyChange]);
  return { ...panel, draft: panel.target, dirtyChanged, complete: panel.close };
}
