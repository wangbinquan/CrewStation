import { useCallback, useEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { NativeTerminalDto, WorkspaceToolName } from '@crewstation/contracts';
import { errorMessage } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { SplitGrid } from '../../../../shared/ui/split/SplitGrid';
import { useWorkspaceLayout } from '../../hooks/layout/useWorkspaceLayout';
import { useToolPanel } from '../../hooks/layout/useToolPanel';
import { useNativeTerminals } from '../../hooks/native/useNativeTerminals';
import type { TaskStreamChannel } from '../../hooks/useTaskStream';
import type { StreamState } from '../../model/taskStreamSocket';
import { layoutTool, moveTerminal, reconcileWorkspaceLayout, updateWorkspaceTab } from '../../model/layout/workspaceLayout';
import { NativeTerminalCard } from './NativeTerminalCard';
import { NativeToolbar } from './NativeToolbar';
import { NativeWorkspaceTabs } from './NativeWorkspaceTabs';
import { ToolPanel } from '../panel/ToolPanel';
import type { ToolPane } from '../panel/ToolPanel';
import { PanelGutter } from '../panel/PanelGutter';
import styles from './NativeWorkspace.module.css';
import { useAgentActivity } from '../../../../shared/activity/AgentActivityProvider';
import { activityCounts } from '../../../../shared/activity/agentActivityView';
import type { ActivityTarget } from '../../../../shared/activity/agentActivityView';
import { useActivityTarget } from '../../hooks/native/useActivityTarget';
import { useWorkspaceLocation } from '../../hooks/layout/useWorkspaceLocation';
import type { WorkspaceLocation } from '../../model/layout/developmentLocation';

export interface NativeWorkspaceProps {
  readonly projectId: string; readonly taskId: string; readonly userId: string; readonly channel: TaskStreamChannel; readonly stream: StreamState; readonly canDevelop: boolean;
  readonly onActivity: () => void; readonly preview: ReactNode; readonly editor: ReactNode; readonly changes: ReactNode;
  readonly data?: ReactNode; readonly environment?: ReactNode; readonly reference?: ReactNode; readonly dataDirty?: boolean; readonly version?: ReactNode;
  readonly blockedReason?: string; readonly isAdmin?: boolean; readonly activityTarget?: ActivityTarget; readonly editorDirty?: boolean; readonly location?: WorkspaceLocation;
}

/**
 * 开发工作区（RFC-020 D1）：左边终端工作区（一条工具行＋分屏终端），右边工具面板（预览／代码／变更／数据／参考／会话），
 * 可拖宽、收起、放大；底部是版本比较状态条。面板状态与地址都由个人布局的 `tool` 表达。
 */
export function NativeWorkspace(props: NativeWorkspaceProps): ReactElement {
  const { projectId, taskId, userId, channel, stream, canDevelop, onActivity, activityTarget, editorDirty = false, location, dataDirty = false, blockedReason, isAdmin = false } = props;
  const t = useT();
  const { store, state } = useWorkspaceLayout(taskId, userId, t('devSession.native.defaultTab'));
  const layout = state.layout, stage = useRef<HTMLDivElement>(null);
  const panel = useToolPanel(layout, store, location, stage);
  const onStarted = useCallback((terminal: NativeTerminalDto) => {
    store.update((value) => moveTerminal(value, terminal.terminalId, value.tabs.some((tab) => tab.id === layout.activeTabId) ? layout.activeTabId : value.activeTabId));
    onActivity();
  }, [store, layout.activeTabId, onActivity]);
  const native = useNativeTerminals(taskId, channel, stream, onStarted);
  const roster = native.query.data?.items;
  const activity = useAgentActivity(), task = activity.snapshot.tasks.find((task) => task.taskId === taskId);
  const targetError = useActivityTarget(taskId, activityTarget, roster, state.loaded, store, t('devSession.native.defaultTab'));
  const savedTool = layoutTool(layout);
  const locationError = useWorkspaceLocation(taskId, location, roster, store, state.loaded, !!activityTarget, t('devSession.native.defaultTab'), `${savedTool?.name ?? ''}:${savedTool?.mode ?? ''}`, panel.narrow);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = channel.subscribe((event) => { if (event.kind !== 'nativeActivity' && event.kind !== 'nativeTerminal') return; if (timer) clearTimeout(timer); timer = setTimeout(() => void activity.store?.refresh(taskId), 150); });
    return () => { unsubscribe(); if (timer) clearTimeout(timer); };
  }, [channel, activity.store, taskId]);
  useEffect(() => { if (roster) store.update((value) => reconcileWorkspaceLayout(value, roster.map((item) => item.terminalId))); }, [roster, state.loaded, store]);
  const tab = layout.tabs.find((item) => item.id === layout.activeTabId)!;
  const visible = layout.maximizedTerminalId && tab.paneOrder.includes(layout.maximizedTerminalId) ? [layout.maximizedTerminalId] : tab.paneOrder;
  const screen = <SplitGrid mode={tab.layout} ratios={tab.ratios} onResize={(ratios) => store.update((value) => updateWorkspaceTab(value, tab.id, (current) => ({ ...current, ratios })))} separatorLabel={(axis, index) => t(`devSession.native.resize.${axis}`, { index })}
    items={visible.map((terminalId) => ({ id: terminalId, content: <NativeTerminalCard terminalId={terminalId} terminal={roster?.find((item) => item.terminalId === terminalId)} activity={task} activitySync={native.query.data?.activitySync} layout={layout} store={store} channel={channel} stream={stream} onStop={(id) => native.stop.mutate(id)} onTerminalChange={native.query.refetch} onRetry={canDevelop && stream.runnerConnected && !native.start.isPending && !native.retryingOriginal ? (terminal) => native.launch(terminal.compute, terminal.permission) : undefined} onActivity={onActivity} canDevelop={canDevelop} viewerId={userId} /> }))} />;
  const terminalContent = visible.length === 0 ? <div className={styles.empty}><strong>{t(blockedReason ? 'devSession.native.notReady' : 'devSession.native.empty')}</strong><p>{blockedReason ?? t('devSession.native.emptyHint')}</p>{blockedReason && props.environment ? <Button onClick={() => panel.select('session')}>{t('devSession.connection.details')}</Button> : null}</div> : screen;
  const counts = activityCounts(task);
  const panes: ToolPane[] = [];
  panes.push({ name: 'preview', content: props.preview, fill: true });
  panes.push({ name: 'code', content: props.editor, keepMounted: true, fill: true, suffix: editorDirty ? t('devSession.editor.dirty') : undefined });
  panes.push({ name: 'changes', content: props.changes });
  if (props.data !== undefined) panes.push({ name: 'data', content: props.data, keepMounted: true, suffix: dataDirty ? t('devSession.editor.dirty') : undefined });
  if (props.reference !== undefined) panes.push({ name: 'reference', content: props.reference, keepMounted: true });
  if (props.environment !== undefined) panes.push({ name: 'session', content: props.environment, keepMounted: true });
  const columns = panel.mode === 'side' ? `minmax(0, ${1 - (panel.tool?.ratio ?? 0.45)}fr) 6px minmax(0, ${panel.tool?.ratio ?? 0.45}fr)` : panel.mode === 'full' ? '0 0 minmax(0, 1fr)' : 'minmax(0, 1fr) 0 auto';
  return <section className={styles.workspace}>
    {state.phase === 'loading' ? <p role="status">{t('devSession.native.layoutLoading')}</p> : null}
    {targetError ? <p className={styles.error} role="status">{t(targetError)}</p> : null}
    {locationError ? <p className={styles.error} role="status">{t(locationError)}</p> : null}
    {state.error ? <div className={styles.error} role="status">{state.error}<Button onClick={() => void (state.loaded ? store.reapply() : store.load())}>{t('devSession.native.reapply')}</Button>{state.loaded ? <Button onClick={() => void store.useRemote()}>{t('devSession.native.useRemote')}</Button> : null}</div> : null}
    <div className={styles.stage} ref={stage} data-panel={panel.mode} style={{ gridTemplateColumns: columns }}>
      <div className={styles.main} hidden={panel.mode === 'full'}>
        {native.query.error || native.start.error || native.stop.error ? <p className={styles.error} role="status">{errorMessage(native.query.error ?? native.start.error ?? native.stop.error)}{native.query.error ? <Button onClick={() => void native.query.refetch()}>{t('devSession.connection.check')}</Button> : null}</p> : null}
        <NativeWorkspaceTabs taskId={taskId} layout={layout} store={store} loaded={state.loaded}
          toolbar={<NativeToolbar projectId={projectId} taskId={taskId} layout={layout} store={store} native={native} roster={roster} canStart={state.loaded && canDevelop && stream.runnerConnected && !blockedReason} blockedReason={blockedReason ?? (!state.loaded ? t('devSession.native.layoutLoading') : !canDevelop ? t('devSession.connection.noPermission') : undefined)} isAdmin={isAdmin} />}>
          <div className={styles.terminals}>{terminalContent}</div>
        </NativeWorkspaceTabs>
      </div>
      <PanelGutter hidden={panel.mode !== 'side'} ratio={panel.tool?.ratio ?? 0.45} container={stage} onResize={panel.resize} label={t('devSession.panel.resize')} />
      <ToolPanel active={panel.tool?.name} mode={panel.mode} panes={panes} forcedFull={panel.forcedFull} onSelect={(name: WorkspaceToolName) => panel.select(name)} onToggleMode={panel.toggleMode} onClose={panel.close} />
    </div>
    <footer className={styles.footer}>
      <div className={styles.status}>{props.version}{counts.pending ? <span className={styles.waiting}>{t('activity.pendingCount', { count: counts.pending })}</span> : null}</div>
      <span>{editorDirty ? t('devSession.editor.draftLifetime') : t('devSession.native.sharedHint')}</span><span>{state.phase === 'saving' || state.dirty && !state.error ? t('devSession.native.savingLayout') : state.loaded && !state.error && state.revision > 0 ? t('devSession.native.personalLayout') : ''}</span>
    </footer>
  </section>;
}
