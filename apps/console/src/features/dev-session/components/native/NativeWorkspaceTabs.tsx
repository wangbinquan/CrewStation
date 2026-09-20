import type { ReactNode } from 'react';
import type { NativeTerminalDto, WorkspaceLayout } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { Tabs } from '../../../../shared/ui/Tabs';
import { useAgentActivity } from '../../../../shared/activity/AgentActivityProvider';
import { activityCounts, activityStatus } from '../../../../shared/activity/agentActivityView';
import type { WorkspaceLayoutStore } from '../../model/layout/workspaceLayoutStore';
import { addWorkspaceTab, moveTerminal } from '../../model/layout/workspaceLayout';
import styles from './NativeWorkspace.module.css';

/** 第二层只管理个人工作区；创建工作区不会启动 CLI，收起窗口也不会结束进程。 */
export function NativeWorkspaceTabs({ taskId, layout, store, loaded, roster, children }: {
  readonly taskId: string; readonly layout: WorkspaceLayout; readonly store: WorkspaceLayoutStore; readonly loaded: boolean;
  readonly roster: NativeTerminalDto[] | undefined; readonly children: ReactNode;
}) {
  const t = useT(), activity = useAgentActivity(), task = activity.snapshot.tasks.find((item) => item.taskId === taskId);
  return <Tabs label={t('devSession.native.tabs')} value={layout.activeTabId}
    items={layout.tabs.map((tab) => { const counts = activityCounts(task, tab.paneOrder); return { value: tab.id, label: <span>{tab.name} · {tab.paneOrder.length}
      {counts.pending ? <b className={styles.waiting}> · {t('activity.pendingCount', { count: counts.pending })}</b> : null}
      {counts.completions ? <b className={styles.completed}> · {t('activity.completedCount', { count: counts.completions })}</b> : null}
      {counts.running ? <span> · {t('activity.runningCount', { count: counts.running })}</span> : null}</span> }; })}
    onChange={(value) => store.update((current) => ({ ...current, activeTabId: value, view: 'cli' }))}
    extra={<><Button variant="ghost" disabled={!loaded || layout.tabs.length >= 16} onClick={() => store.update((value) => addWorkspaceTab(value, t('devSession.native.numberedTab', { count: value.tabs.length + 1 })))}>{t('devSession.native.addTab')}</Button>
      <details className={styles.menu}><summary>{t('devSession.native.roster', { count: roster?.length ?? 0 })}</summary><div className={styles.roster}>
        {roster?.map((terminal) => <div key={terminal.terminalId}><code>CLI {terminal.agentId.slice(-6)}</code><span>{terminal.compute} · {t(`activity.status.${activityStatus(terminal, task?.page?.states.find((item) => item.terminalId === terminal.terminalId) ?? terminal.activity, task?.page, task?.stale)}`)}</span>
          <Button onClick={() => store.update((value) => ({ ...moveTerminal(value, terminal.terminalId, value.activeTabId), view: 'cli' }))}>{t('devSession.native.restore')}</Button></div>)}
        <small>{t('devSession.native.sharedHint')}</small>
      </div></details></>}>
    {children}
  </Tabs>;
}
