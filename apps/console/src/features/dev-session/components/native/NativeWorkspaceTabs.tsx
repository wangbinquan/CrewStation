import type { ReactNode } from 'react';
import type { WorkspaceLayout } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { Tabs } from '../../../../shared/ui/Tabs';
import { useAgentActivity } from '../../../../shared/activity/AgentActivityProvider';
import { activityCounts } from '../../../../shared/activity/agentActivityView';
import type { WorkspaceLayoutStore } from '../../model/layout/workspaceLayoutStore';
import { addWorkspaceTab } from '../../model/layout/workspaceLayout';
import styles from './NativeWorkspace.module.css';

/** 一条工具行：左边个人工作区页签与「＋」，右边 toolbar（创建 CLI、布局、更多）。创建工作区不会启动 CLI，收起窗口也不会结束进程。 */
export function NativeWorkspaceTabs({ taskId, layout, store, loaded, toolbar, children }: {
  readonly taskId: string; readonly layout: WorkspaceLayout; readonly store: WorkspaceLayoutStore; readonly loaded: boolean;
  readonly toolbar: ReactNode; readonly children: ReactNode;
}) {
  const t = useT(), activity = useAgentActivity(), task = activity.snapshot.tasks.find((item) => item.taskId === taskId);
  return <Tabs label={t('devSession.native.tabs')} value={layout.activeTabId}
    items={layout.tabs.map((tab) => { const counts = activityCounts(task, tab.paneOrder); return { value: tab.id, label: <span>{tab.name} · {tab.paneOrder.length}
      {counts.pending ? <b className={styles.waiting}> · {t('activity.pendingCount', { count: counts.pending })}</b> : null}
      {counts.completions ? <b className={styles.completed}> · {t('activity.completedCount', { count: counts.completions })}</b> : null}
      {counts.running ? <span> · {t('activity.runningCount', { count: counts.running })}</span> : null}</span> }; })}
    onChange={(value) => store.update((current) => ({ ...current, activeTabId: value }))}
    extra={<div className={styles.toolbar}>
      <Button variant="ghost" title={t('devSession.native.addTab')} aria-label={t('devSession.native.addTab')} disabled={!loaded || layout.tabs.length >= 16} onClick={() => store.update((value) => addWorkspaceTab(value, t('devSession.native.numberedTab', { count: value.tabs.length + 1 })))}>＋</Button>
      {toolbar}
    </div>}>
    {children}
  </Tabs>;
}
