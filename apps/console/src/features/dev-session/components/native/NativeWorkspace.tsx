import { useCallback, useEffect } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { NativeTerminalDto } from '@crewstation/contracts';
import { errorMessage } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { Tabs } from '../../../../shared/ui/Tabs';
import { SplitGrid } from '../../../../shared/ui/split/SplitGrid';
import { useWorkspaceLayout } from '../../hooks/layout/useWorkspaceLayout';
import { useNativeTerminals } from '../../hooks/native/useNativeTerminals';
import type { TaskStreamChannel } from '../../hooks/useTaskStream';
import type { StreamState } from '../../model/taskStreamSocket';
import { addWorkspaceTab, moveTerminal, reconcileWorkspaceLayout, updateWorkspaceTab } from '../../model/layout/workspaceLayout';
import { NativeTerminalCard } from './NativeTerminalCard';
import { NativeToolbar } from './NativeToolbar';
import styles from './NativeWorkspace.module.css';
import { useAgentActivity } from '../../../../shared/activity/AgentActivityProvider';
import { activityCounts, activityStatus } from '../../../../shared/activity/agentActivityView';
import type { ActivityTarget } from '../../../../shared/activity/agentActivityView';
import { useActivityTarget } from '../../hooks/native/useActivityTarget';

export function NativeWorkspace({ taskId, userId, channel, stream, canDevelop, onActivity, preview, editor, changes, activityTarget }: {
  readonly taskId: string; readonly userId: string; readonly channel: TaskStreamChannel; readonly stream: StreamState; readonly canDevelop: boolean;
  readonly onActivity: () => void; readonly preview: ReactNode; readonly editor: ReactNode; readonly changes: ReactNode;
  readonly activityTarget?: ActivityTarget;
}): ReactElement {
  const t = useT();
  const { store, state } = useWorkspaceLayout(taskId, userId, t('devSession.native.defaultTab'));
  const layout = state.layout;
  const onStarted = useCallback((terminal: NativeTerminalDto) => {
    store.update((value) => moveTerminal(value, terminal.terminalId, value.tabs.some((tab) => tab.id === layout.activeTabId) ? layout.activeTabId : value.activeTabId));
    onActivity();
  }, [store, layout.activeTabId, onActivity]);
  const native = useNativeTerminals(taskId, channel, stream, onStarted);
  const roster = native.query.data?.items;
  const activity = useAgentActivity(), task = activity.snapshot.tasks.find((task) => task.taskId === taskId);
  const targetError = useActivityTarget(taskId, activityTarget, roster, state.loaded, store, t('devSession.native.defaultTab'));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = channel.subscribe((event) => { if (event.kind !== 'nativeActivity' && event.kind !== 'nativeTerminal') return; if (timer) clearTimeout(timer); timer = setTimeout(() => void activity.store?.refresh(taskId), 150); });
    return () => { unsubscribe(); if (timer) clearTimeout(timer); };
  }, [channel, activity.store, taskId]);
  useEffect(() => { if (roster) store.update((value) => reconcileWorkspaceLayout(value, roster.map((item) => item.terminalId))); }, [roster, state.loaded, store]);
  const tab = layout.tabs.find((item) => item.id === layout.activeTabId)!;
  const visible = layout.maximizedTerminalId && tab.paneOrder.includes(layout.maximizedTerminalId) ? [layout.maximizedTerminalId] : tab.paneOrder;
  const screen = <SplitGrid mode={tab.layout} ratios={tab.ratios} onResize={(ratios) => store.update((value) => updateWorkspaceTab(value, tab.id, (current) => ({ ...current, ratios })))} separatorLabel={(axis, index) => t(`devSession.native.resize.${axis}`, { index })}
    items={visible.map((terminalId) => ({ id: terminalId, content: <NativeTerminalCard terminalId={terminalId} terminal={roster?.find((item) => item.terminalId === terminalId)} activity={task} activitySync={native.query.data?.activitySync} layout={layout} store={store} channel={channel} stream={stream} onStop={(id) => native.stop.mutate(id)} onActivity={onActivity} canDevelop={canDevelop} /> }))} />;
  return <section className={styles.workspace}>
    {state.phase === 'loading' ? <p role="status">{t('devSession.native.layoutLoading')}</p> : null}
    {targetError ? <p className={styles.error} role="status">{t(targetError)}</p> : null}
    {state.error ? <div className={styles.error} role="status">{state.error}<Button onClick={() => void (state.loaded ? store.reapply() : store.load())}>{t('devSession.native.reapply')}</Button>{state.loaded ? <Button onClick={() => void store.useRemote()}>{t('devSession.native.useRemote')}</Button> : null}</div> : null}
    <Tabs label={t('devSession.native.tabs')} value={layout.view === 'cli' ? layout.activeTabId : layout.view} items={[...layout.tabs.map((tab) => { const counts = activityCounts(task, tab.paneOrder); return { value: tab.id, label: <span>{tab.name} · {tab.paneOrder.length}{counts.pending ? <b className={styles.waiting}> · {t('activity.pendingCount', { count: counts.pending })}</b> : null}{counts.completions ? <b className={styles.completed}> · {t('activity.completedCount', { count: counts.completions })}</b> : null}{counts.running ? <span> · {t('activity.runningCount', { count: counts.running })}</span> : null}</span> }; }), ...(['preview', 'code', 'changes'] as const).map((value) => ({ value, label: t(`devSession.native.view.${value}`) }))]}
      onChange={(value) => store.update((current) => current.tabs.some((tab) => tab.id === value) ? { ...current, activeTabId: value, view: 'cli' } : { ...current, view: value as 'preview' | 'code' | 'changes' })}
      extra={<><Button variant="ghost" disabled={!state.loaded || layout.tabs.length >= 16} onClick={() => store.update((value) => addWorkspaceTab(value, t('devSession.native.numberedTab', { count: value.tabs.length + 1 })))}>{t('devSession.native.addTab')}</Button><details className={styles.menu}><summary>{t('devSession.native.roster', { count: roster?.length ?? 0 })}</summary><div className={styles.roster}>
        {roster?.map((terminal) => <div key={terminal.terminalId}><code>CLI {terminal.agentId.slice(-6)}</code><span>{terminal.compute} · {t(`activity.status.${activityStatus(terminal, task?.page?.states.find((state) => state.terminalId === terminal.terminalId) ?? terminal.activity, task?.page, task?.stale)}`)}</span><Button onClick={() => store.update((value) => ({ ...moveTerminal(value, terminal.terminalId, value.activeTabId), view: 'cli' }))}>{t('devSession.native.restore')}</Button></div>)}
        <small>{t('devSession.native.sharedHint')}</small>
      </div></details></>}>
      {native.query.error || native.start.error || native.stop.error ? <p className={styles.error} role="status">{errorMessage(native.query.error ?? native.start.error ?? native.stop.error)}</p> : null}
      {layout.view === 'cli' ? <>
        <NativeToolbar layout={layout} store={store} native={native} canStart={state.loaded && canDevelop && stream.runnerConnected} />
        <div className={styles.stage}>{visible.length === 0 ? <div className={styles.empty}><strong>{t('devSession.native.empty')}</strong><p>{t('devSession.native.emptyHint')}</p></div> : layout.previewAlongside ? <SplitGrid items={[{ id: 'terminals', content: screen }, { id: 'preview', content: preview }]} mode="columns" ratios={{ columns: [layout.previewRatio, 1 - layout.previewRatio], rows: [1] }} separatorLabel={(axis, index) => t(`devSession.native.resize.${axis}`, { index })} onResize={(ratios) => store.update((value) => ({ ...value, previewRatio: Math.max(0.25, Math.min(0.75, ratios.columns[0] ?? 0.5)) }))} /> : screen}</div>
      </> : <div className={styles.stage}>{layout.view === 'preview' ? preview : layout.view === 'code' ? editor : changes}</div>}
    </Tabs>
    <footer className={styles.footer}><span>{t('devSession.native.sharedHint')}</span><span>{state.phase === 'saving' || state.dirty && !state.error ? t('devSession.native.savingLayout') : state.loaded && !state.error && state.revision > 0 ? t('devSession.native.personalLayout') : ''}</span></footer>
  </section>;
}
