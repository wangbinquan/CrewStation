import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { NativeTerminalDto, WorkspaceToolName } from '@crewstation/contracts';
import { errorMessage, retryableReadError } from '../../../../shared/api/useApi';
import type { Translate } from '../../../../shared/lib/useT';
import { useT } from '../../../../shared/lib/useT';
import { Button, ButtonSizeContext } from '../../../../shared/ui/Button';
import { useWorkspaceLayout } from '../../hooks/layout/useWorkspaceLayout';
import { useToolPanel } from '../../hooks/layout/useToolPanel';
import { useCliLauncher } from '../../hooks/native/useCliLauncher';
import { useNativeTerminals } from '../../hooks/native/useNativeTerminals';
import type { TaskStreamChannel } from '../../hooks/useTaskStream';
import type { StreamState } from '../../model/taskStreamSocket';
import { openTerminal, reconcileTerminals, replaceTerminal } from '../../model/layout/terminalGroups';
import { withRecordPhases } from '../../model/native/terminalPhase';
import { useProjectResources } from '../../../../shared/resources/useProjectResources';
import { layoutTool } from '../../model/layout/workspaceLayout';
import { CliDock } from './CliDock';
import { NewCliButton, NewCliNotice } from './NewCliButton';
import { ToolPanel } from '../panel/ToolPanel';
import type { ToolPane } from '../panel/ToolPanel';
import { PanelGutter } from '../panel/PanelGutter';
import styles from './NativeWorkspace.module.css';
import { useAgentActivity } from '../../../../shared/activity/AgentActivityProvider';
import type { AgentActivityStore } from '../../../../shared/activity/agentActivityStore';
import { activityCounts } from '../../../../shared/activity/agentActivityView';
import type { ActivityTarget } from '../../../../shared/activity/agentActivityView';
import { useActivityTarget } from '../../hooks/native/useActivityTarget';
import { useWorkspaceLocation } from '../../hooks/layout/useWorkspaceLocation';
import type { WorkspaceLocation } from '../../model/layout/developmentLocation';
import type { WorkspaceReadiness } from '../../model/connection/entryProgress';

/**
 * 连接就绪之前整页只显示 `cover`（2026-09-23 作者裁定），工作区不渲染；个人布局、CLI 名册与算力档位照常先读，
 * 连接就绪且三者读完才揭开，揭开后同一次挂载内不再盖回（之后的断线、失败与重建用工作区里原有的提示）。
 */
export interface WorkspaceGate {
  /** 连接已就绪：会话在运行，页面通道与开发环境都连上，也没有启动步骤条。 */
  readonly connected: boolean;
  /** 用户不等了（「仍然打开工作区」）。 */
  readonly forced: boolean;
  readonly cover: (workspace: WorkspaceReadiness) => ReactNode;
}

export interface NativeWorkspaceProps {
  readonly projectId: string; readonly taskId: string; readonly userId: string; readonly channel: TaskStreamChannel; readonly stream: StreamState; readonly canDevelop: boolean;
  readonly onActivity: () => void; readonly preview: ReactNode; readonly editor: ReactNode; readonly changes: ReactNode;
  readonly data?: ReactNode; readonly environment?: ReactNode; readonly reference?: ReactNode; readonly dataDirty?: boolean; readonly version?: ReactNode;
  readonly blockedReason?: string; readonly isAdmin?: boolean; readonly activityTarget?: ActivityTarget; readonly editorDirty?: boolean; readonly location?: WorkspaceLocation;
  /** 页头由页面给出，「＋ 创建开发Agent会话 ▾」放进它的操作区；不给时按钮单独一行（组件单独渲染时）。 */
  readonly header?: (newCli: ReactNode) => ReactNode;
  /** 开发会话开始开发、重建或启动失败时（RFC-022）：CLI 区域整块换成这个步骤条，居中显示。 */
  readonly startup?: ReactNode;
  /** 给了就先整页显示加载层，揭开前不渲染工作区（组件单独渲染、不给时直接显示工作区）。 */
  readonly gate?: WorkspaceGate;
}

/**
 * 开发工作区（RFC-020 D1；CLI 区 2026-09-23 起为 Xshell 式标签组）：左边 CLI 区，右边工具面板（预览／代码／变更／数据／参考／会话），
 * 可拖宽、收起、放大；底部是版本比较状态条。新开 CLI 的唯一入口在页头；面板状态与地址都由个人布局的 `tool` 表达。
 */
export function NativeWorkspace(props: NativeWorkspaceProps): ReactElement {
  const { projectId, taskId, userId, channel, stream, canDevelop, onActivity, activityTarget, location, blockedReason, isAdmin = false } = props;
  const t = useT();
  const { store, state } = useWorkspaceLayout(taskId, userId, t('devSession.native.defaultTab'));
  const layout = state.layout, stage = useRef<HTMLDivElement>(null);
  // 揭开与否决定 stage 挂在哪个元素上（加载层或主区）：窄屏判定在揭开前就量加载层，布局恢复不会在揭开后再跳一次。
  const [revealedOnce, setRevealedOnce] = useState(false);
  const panel = useToolPanel(layout, store, location, stage, revealedOnce);
  // 重试启动失败的 CLI 时原位替换（RFC-022 Q2）：新的占据旧标签的位置，旧的记进已关闭列表，不再被名册同步重新打开。
  const onStarted = useCallback((terminal: NativeTerminalDto, replaces?: string) => {
    store.update((value) => (replaces ? replaceTerminal(value, replaces, terminal.terminalId) : openTerminal(value, terminal.terminalId, { activate: true })));
    onActivity();
  }, [store, onActivity]);
  const native = useNativeTerminals(taskId, channel, stream, onStarted);
  // CLI 结束与失败以资源台账为准（RFC-025）：推送流一到，每个窗口的标签同时变「结束中」「已结束」，关掉的不会被对账放回。
  const records = useProjectResources(projectId), items = native.query.data?.items;
  const roster = useMemo(() => withRecordPhases(items, records.data?.items), [items, records.data]);
  const activity = useAgentActivity(), task = activity.snapshot.tasks.find((item) => item.taskId === taskId);
  const savedTool = layoutTool(layout);
  const locationError = useWorkspaceLocation(taskId, location, roster, store, state.loaded, !!activityTarget, `${savedTool?.name ?? ''}:${savedTool?.mode ?? ''}`, panel.narrow);
  useActivityRefresh(channel, activity.store, taskId);
  useEffect(() => { if (roster) store.update((value) => reconcileTerminals(value, roster)); }, [roster, state.loaded, store]);
  const launcher = useCliLauncher(projectId, layout, store, native, state.loaded && canDevelop && stream.runnerConnected && !blockedReason);
  const readiness: WorkspaceReadiness = { layout: state.loaded || state.error !== undefined, terminals: native.query.data !== undefined || native.query.isError,
    profiles: !canDevelop || launcher.profiles.data !== undefined || launcher.profiles.isError };
  const open = !props.gate || props.gate.forced || props.gate.connected && readiness.layout && readiness.terminals && readiness.profiles;
  if (open && !revealedOnce) setRevealedOnce(true);
  const revealed = open || revealedOnce;
  // 从动态通知跳来的定位要聚焦那张终端卡：揭开之后卡片才在页面上。
  const targetError = useActivityTarget(taskId, activityTarget, roster, state.loaded && revealed, store);
  const reason = blockedReason ?? (!state.loaded ? t('devSession.native.layoutLoading') : !canDevelop ? t('devSession.connection.noPermission') : launcher.profiles.isPending ? t('devSession.native.loadingProfiles') : launcher.blockText);
  const newCli = <NewCliButton launcher={launcher} reason={reason} />;
  const retry = canDevelop && stream.runnerConnected && !native.start.isPending && !native.retryingOriginal ? (terminal: NativeTerminalDto) => native.launch(terminal.compute, terminal.terminalId) : undefined;
  const columns = panel.mode === 'side' ? `minmax(0, ${1 - (panel.tool?.ratio ?? 0.45)}fr) 6px minmax(0, ${panel.tool?.ratio ?? 0.45}fr)` : panel.mode === 'full' ? '0 0 minmax(0, 1fr)' : 'minmax(0, 1fr) 0 auto';
  // 揭开前：整页只有加载层，与主区同宽，量窄屏就量它（没有内边距，宽度与揭开后的主区一致）。
  if (!revealed && props.gate) return <div className={styles.cover} ref={stage}>{props.gate.cover(readiness)}</div>;
  return <>
    {props.header ? props.header(newCli) : <div className={styles.headerFallback}>{newCli}</div>}
    <NewCliNotice launcher={launcher} isAdmin={isAdmin} />
    {/* 开发页整片是工具条密度：区域里的动作按钮一律紧凑档（2026-09-23 裁定），不再在样式里改写按钮尺寸。 */}
    <ButtonSizeContext.Provider value="small">
    <section className={styles.workspace}>
      {state.phase === 'loading' ? <p role="status">{t('devSession.native.layoutLoading')}</p> : null}
      {targetError ? <p className={styles.error} role="status">{t(targetError)}</p> : null}
      {locationError ? <p className={styles.error} role="status">{t(locationError)}</p> : null}
      {state.error ? <div className={styles.error} role="status">{state.error}<Button onClick={() => void (state.loaded ? store.reapply() : store.load())}>{t('devSession.native.reapply')}</Button>{state.loaded ? <Button onClick={() => void store.useRemote()}>{t('devSession.native.useRemote')}</Button> : null}</div> : null}
      <div className={styles.stage} ref={stage} data-panel={panel.mode} style={{ gridTemplateColumns: columns }}>
        <div className={styles.main} hidden={panel.mode === 'full'}>
          {native.query.error || native.start.error || native.stop.error ? <p className={styles.error} role="status">{errorMessage(native.query.error ?? native.start.error ?? native.stop.error)}{native.query.error && retryableReadError(native.query.error) ? ` ${t('ui.status.autoRetry')}` : null}</p> : null}
          <div className={styles.terminals} role="region" aria-label={t('devSession.native.area')}>
            {props.startup ? <div className={styles.sessionStartup}>{props.startup}</div> : <CliDock projectId={projectId} layout={layout} store={store} roster={roster} native={native} launcher={launcher} channel={channel} stream={stream} activity={task}
              canDevelop={canDevelop} viewerId={userId} onActivity={onActivity} blockedReason={blockedReason} onRetry={retry}
              onDetails={blockedReason && props.environment ? () => panel.select('session') : undefined} />}
          </div>
        </div>
        <PanelGutter hidden={panel.mode !== 'side'} ratio={panel.tool?.ratio ?? 0.45} container={stage} onResize={panel.resize} label={t('devSession.panel.resize')} />
        <ToolPanel active={panel.tool?.name} mode={panel.mode} panes={toolPanes(props, t)} forcedFull={panel.forcedFull} onSelect={(name: WorkspaceToolName) => panel.select(name)} onToggleMode={panel.toggleMode} onClose={panel.close} />
      </div>
      <footer className={styles.footer}>
        <div className={styles.status}>{props.version}{activityCounts(task).pending ? <span className={styles.waiting}>{t('activity.pendingCount', { count: activityCounts(task).pending })}</span> : null}</div>
        <span>{props.editorDirty ? t('devSession.editor.draftLifetime') : t('devSession.native.sharedHint')}</span><span>{state.phase === 'saving' || state.dirty && !state.error ? t('devSession.native.savingLayout') : state.loaded && !state.error && state.revision > 0 ? t('devSession.native.personalLayout') : ''}</span>
      </footer>
    </section>
    </ButtonSizeContext.Provider>
  </>;
}

function toolPanes(props: NativeWorkspaceProps, t: Translate): ToolPane[] {
  const panes: ToolPane[] = [];
  panes.push({ name: 'preview', content: props.preview, fill: true });
  panes.push({ name: 'code', content: props.editor, keepMounted: true, fill: true, suffix: props.editorDirty ? t('devSession.editor.dirty') : undefined });
  panes.push({ name: 'changes', content: props.changes, fill: true });
  if (props.data !== undefined) panes.push({ name: 'data', content: props.data, keepMounted: true, suffix: props.dataDirty ? t('devSession.editor.dirty') : undefined });
  if (props.reference !== undefined) panes.push({ name: 'reference', content: props.reference, keepMounted: true });
  if (props.environment !== undefined) panes.push({ name: 'session', content: props.environment, keepMounted: true });
  return panes;
}

/** 名册或动态有变化时稍后刷新顶部动态（合并 150 ms 内的多次变化）。 */
function useActivityRefresh(channel: TaskStreamChannel, store: AgentActivityStore | null | undefined, taskId: string): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = channel.subscribe((event) => { if (event.kind !== 'nativeActivity' && event.kind !== 'nativeTerminal') return; if (timer) clearTimeout(timer); timer = setTimeout(() => void store?.refresh(taskId), 150); });
    return () => { unsubscribe(); if (timer) clearTimeout(timer); };
  }, [channel, store, taskId]);
}
