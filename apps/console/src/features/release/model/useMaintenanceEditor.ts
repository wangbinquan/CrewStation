import { useEffect, useState } from 'react';
import type { MaintenanceDto } from '@crewstation/contracts';
import { draftFromMaintenance, emptyMaintenanceDraft, maintenanceDraftChanged } from './maintenanceDraft';
import type { MaintenanceDraft } from './maintenanceDraft';
import type { ReleaseActions } from './useReleaseActions';

/** 一份维护草稿：进入维护从默认值起，调整从打开时的维护带出，并记住当时的版本号（提交时带上，别人先改过时服务端 409）。 */
export interface MaintenanceEditorDraft {
  readonly mode: 'enter' | 'update';
  readonly revision: number;
  readonly base: MaintenanceDraft;
  readonly draft: MaintenanceDraft;
}

function freshDraft(current: MaintenanceDto | null): MaintenanceEditorDraft {
  const base = current ? draftFromMaintenance(current) : emptyMaintenanceDraft();
  return { mode: current ? 'update' : 'enter', revision: current?.revision ?? 0, base, draft: base };
}

/**
 * 维护弹窗的开关与草稿（2026-09-23 裁定）：关窗只收起、草稿留在页面上，再打开同一种（进入／调整）时恢复；
 * 「清空」按此刻的维护状态重起一份；保存成功才丢掉。草稿改过就进页面的离开确认。
 * `current` 为 undefined 表示维护状态还没读到，这时不能打开。
 */
export function useMaintenanceEditor(current: MaintenanceDto | null | undefined, actions: ReleaseActions) {
  const [editor, setEditor] = useState<MaintenanceEditorDraft>(), [isOpen, setOpen] = useState(false);
  const dirty = !!editor && maintenanceDraftChanged(editor.draft, editor.base), { markDraft } = actions;
  useEffect(() => { markDraft('maintenance', dirty); }, [dirty, markDraft]);
  useEffect(() => () => markDraft('maintenance', false), [markDraft]);
  return {
    editor, dirty, isOpen: isOpen && !!editor,
    open: () => {
      if (current === undefined) return;
      const mode = current ? 'update' : 'enter';
      // 同一种的草稿还在就接着用；维护状态在关窗期间变了（别人进入或退出了维护）就按此刻重起。
      setEditor((previous) => (previous?.mode === mode ? previous : freshDraft(current)));
      setOpen(true);
    },
    close: () => setOpen(false),
    update: (patch: Partial<MaintenanceDraft>) => setEditor((previous) => (previous ? { ...previous, draft: { ...previous.draft, ...patch } } : previous)),
    clear: () => { if (current !== undefined) setEditor(freshDraft(current)); },
    saved: () => { setEditor(undefined); setOpen(false); },
  };
}
export type MaintenanceEditor = ReturnType<typeof useMaintenanceEditor>;
