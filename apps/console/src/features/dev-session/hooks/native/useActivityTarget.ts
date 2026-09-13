import { useEffect, useRef, useState } from 'react';
import type { NativeTerminalDto } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { useAgentActivity } from '../../../../shared/activity/AgentActivityProvider';
import type { ActivityTarget } from '../../../../shared/activity/agentActivityView';
import type { WorkspaceLayoutStore } from '../../model/layout/workspaceLayoutStore';
import { revealActivityTerminal } from '../../model/layout/workspaceLayout';

/** 用户显式点击后才展开并标记个人已读；会话及终端身份不符时不碰当前布局。 */
export function useActivityTarget(taskId: string, target: ActivityTarget | undefined, terminals: NativeTerminalDto[] | undefined, loaded: boolean, layoutStore: WorkspaceLayoutStore, tabName: string) {
  const { store } = useAgentActivity();
  const handled = useRef<string | undefined>(undefined);
  const revealedTarget = useRef<string | undefined>(undefined);
  const [readError, setReadError] = useState<string | undefined>(undefined);
  const layout = layoutStore.getState().layout;
  const { agentId, terminalId, turnId, eventId, seq, taskId: targetTaskId, navigationId } = target ?? {};
  const targetKey = `${targetTaskId}:${eventId}:${navigationId ?? ''}`;
  const terminal = terminals?.find((item) => item.agentId === target?.agentId && item.terminalId === target?.terminalId);
  const invalid = target && (target.taskId !== taskId || terminals && !terminal);
  const located = Boolean(!invalid && terminal && loaded && layout.view === 'cli' && layout.selectedTerminalId === terminalId && layout.tabs.find((tab) => tab.id === layout.activeTabId)?.paneOrder.includes(terminalId!));
  useEffect(() => {
    if (invalid || !terminalId || !terminal || !loaded) return;
    if (revealedTarget.current === targetKey) return;
    revealedTarget.current = targetKey;
    const revealed = revealActivityTerminal(layout, terminalId, tabName);
    if (revealed !== layout) layoutStore.update(() => revealed);
  }, [invalid, terminalId, terminal, loaded, layout, layoutStore, tabName, targetKey]);
  useEffect(() => {
    if (!located || !agentId || !terminalId || !eventId || targetTaskId !== taskId) return;
    const key = targetKey;
    if (handled.current === key) return;
    const card = [...document.querySelectorAll<HTMLElement>('[data-native-terminal]')].find((element) => element.dataset.nativeTerminal === terminalId);
    card?.focus(); card?.scrollIntoView?.({ block: 'nearest' });
    if (!store || !turnId || seq === undefined || seq < 1) return;
    handled.current = key;
    let active = true, settled = false;
    void api.devSession.getAgentActivity(taskId, { cursor: seq - 1, limit: 1 }).then(async (page) => {
      const event = page.items.find((item) => item.eventId === eventId && item.seq === seq && item.agentId === agentId && item.terminalId === terminalId && item.turnId === turnId);
      const pending = page.states.find((state) => state.agentId === agentId && state.terminalId === terminalId)?.pending.find((request) => request.eventId === eventId && request.turnId === turnId && request.seq === seq);
      if (!active) return;
      if (!event && !pending) { setReadError(key); return; }
      await store.read(taskId, { agentId, turnId, throughSeq: seq });
      settled = true;
      if (active) setReadError(undefined);
    }).catch(() => { if (active) setReadError(key); });
    return () => { active = false; if (!settled && handled.current === key) handled.current = undefined; };
  }, [taskId, targetTaskId, agentId, terminalId, turnId, eventId, seq, located, store, targetKey]);
  return invalid ? 'activity.invalidTarget' : readError === targetKey ? 'activity.readFailed' : undefined;
}
