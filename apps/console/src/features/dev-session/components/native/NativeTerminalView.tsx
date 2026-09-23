import type { NativeTerminalDto } from '@crewstation/contracts';
import { NativeTerminalSnapshotDtoSchema } from '@crewstation/contracts';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Translate } from '../../../../shared/lib/useT';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { StageProgress, StageSummary } from '../../../../shared/ui/progress/StageProgress';
import type { TaskStreamChannel } from '../../hooks/useTaskStream';
import { useCreatorClaim } from '../../hooks/native/useCreatorClaim';
import { useTerminalFocus } from '../../hooks/native/useTerminalFocus';
import type { StreamState } from '../../model/taskStreamSocket';
import { NativeTerminalAttachment } from '../../model/native/nativeTerminalAttachment';
import { NativeTerminalSurface } from '../../model/native/nativeTerminalSurface';
import { terminalControlView } from '../../model/native/terminalControlView';
import type { TerminalControlView } from '../../model/native/terminalControlView';
import styles from './NativeWorkspace.module.css';
import '@xterm/xterm/css/xterm.css';
import { api } from '../../../../shared/api/client';
import { errorMessage, useApiQuery } from '../../../../shared/api/useApi';

interface NativeTerminalViewProps {
  readonly terminal: NativeTerminalDto; readonly channel: TaskStreamChannel; readonly stream: StreamState; readonly onActivity: () => void; readonly canDevelop: boolean;
  /** 当前用户：输入控制在自己另一个窗口时据此显示「你在另一个窗口中输入」。 */
  readonly viewerId?: string;
  /** 与输入控制同一条细信息条的左半：轮次状态、档位、资源（2026-09-23 起每窗不再有标题栏）。 */
  readonly info?: ReactNode;
  /** 信息条之下、终端之上的说明（准备中、失败与重试）。 */
  readonly notices?: ReactNode;
  /** 启动失败时步骤条上的「重试」（RFC-022 Q2：原位替换）；不给则不显示。 */
  readonly onRetry?: (terminal: NativeTerminalDto) => void;
}

export function NativeTerminalView(props: NativeTerminalViewProps): ReactElement {
  if (props.terminal.startup?.state === 'failed') return <StartupFailedView terminal={props.terminal} info={props.info} onRetry={props.onRetry} />;
  return props.terminal.execution && ['ended', 'failed'].includes(props.terminal.lifecycle) ? <SavedNativeTerminalView terminal={props.terminal} info={props.info} notices={props.notices} /> : <LiveNativeTerminalView {...props} />;
}

/** 启动失败（RFC-022 D3）：步骤条停在出错的那一段，写出原因，给「重试」与「查看执行容器日志」；没有末屏可看。 */
function StartupFailedView({ terminal, info, onRetry }: Pick<NativeTerminalViewProps, 'terminal' | 'info' | 'onRetry'>): ReactElement {
  const t = useT(), startup = terminal.startup!;
  return <>
    <div className={styles.statusBar}>{info ? <span className={styles.info}>{info}</span> : null}
      <div className={styles.controlLine} data-control="failed" role="status"><StageSummary progress={startup} /></div></div>
    <div className={styles.startupPane} data-static="">
      <StageProgress progress={startup} title={t('devSession.native.startup.failedTitle', { profile: terminal.computeName ?? terminal.compute })}
        logLabel={t('devSession.native.startup.log')} emptyLogText={t('devSession.native.startup.noLog')}
        actions={onRetry ? <Button variant="primary" size="small" onClick={() => onRetry(terminal)}>{t('devSession.native.startup.retry')}</Button> : null} />
    </div>
  </>;
}

function SavedNativeTerminalView({ terminal, info, notices }: Pick<NativeTerminalViewProps, 'terminal' | 'info' | 'notices'>): ReactElement {
  const t = useT(), host = useRef<HTMLDivElement>(null), surface = useMemo(() => new NativeTerminalSurface(terminal.protocol), [terminal.protocol]);
  const screen = useApiQuery(['tasks', terminal.taskId, 'native-screen', terminal.agentId], async () => {
    const result = NativeTerminalSnapshotDtoSchema.parse(await api.devSession.getNativeTerminalSnapshot(terminal.taskId, terminal.agentId));
    if (result.snapshot && (result.snapshot.terminalId !== terminal.terminalId || result.snapshot.runnerId !== terminal.runnerId)) throw new Error(t('devSession.native.screenMismatch'));
    return result;
  }, { refetchIntervalMs: terminal.finalScreen === 'pending' ? 2000 : undefined });
  useEffect(() => { if (host.current) surface.mount(host.current, () => {}, () => {}); return () => surface.dispose(); }, [surface]);
  useEffect(() => { if (screen.data?.snapshot) void surface.restore(screen.data.snapshot); }, [surface, screen.data]);
  return <>
    <div className={styles.statusBar}>{info ? <span className={styles.info}>{info}</span> : null}
      <div className={styles.controlLine}><span>{t(`devSession.native.finalScreen.${screen.data?.status ?? 'pending'}`)}</span>{screen.data?.snapshot?.truncated ? <span title={t('devSession.native.scrollback')}>{t('devSession.native.bounded')}</span> : null}</div></div>
    {notices}
    {screen.error ? <p className={styles.error} role="status">{errorMessage(screen.error)}<Button onClick={() => void screen.refetch()}>{t('devSession.native.reattach')}</Button></p> : null}
    <div className={styles.terminalSurface} ref={host} role="region" tabIndex={0} aria-label={t('devSession.native.screen', { id: terminal.agentId.slice(-6) })} />
  </>;
}

function LiveNativeTerminalView({ terminal, channel, stream, onActivity, canDevelop, viewerId, info, notices }: NativeTerminalViewProps): ReactElement {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const activity = useRef(onActivity);
  useEffect(() => { activity.current = onActivity; }, [onActivity]);
  const { surface, attachment } = useMemo(() => {
    const surface = new NativeTerminalSurface(terminal.protocol);
    return { surface, attachment: new NativeTerminalAttachment(channel, terminal.terminalId, terminal.runnerId, surface) };
  }, [channel, terminal.terminalId, terminal.runnerId, terminal.protocol]);
  const state = useSyncExternalStore(attachment.subscribe, attachment.getState);
  // 进程拉起前 Runner 只接受「取得」：输入与改尺寸先不发（RFC-022）。要在挂载 xterm 之前设好，挂载时的第一次改尺寸才会被记下。
  useEffect(() => attachment.setProcessRunning(terminal.lifecycle === 'running'), [attachment, terminal.lifecycle]);
  useEffect(() => {
    if (!host.current) return;
    surface.mount(host.current, (data) => { attachment.input(data); activity.current(); }, (cols, rows) => attachment.resize(cols, rows));
    attachment.start();
    return () => { attachment.dispose(); surface.dispose(); };
  }, [surface, attachment]);
  useEffect(() => {
    attachment.disconnect();
    if (stream.runnerConnected && terminal.connection === 'connected') attachment.connect();
  }, [attachment, stream.runnerConnected, stream.generation, terminal.connection]);
  useEffect(() => surface.setControlled(state.controlled && state.phase === 'ready'), [surface, state.controlled, state.phase]);
  // 操作终端（点进、Tab 进、按键、切回来）即自动取得输入（2026-09-23 裁定）；被别人占着时取得会被拒，状态条显示是谁。
  const interactive = canDevelop && state.phase === 'ready' && terminal.lifecycle === 'running';
  const take = useCallback(() => {
    if (interactive) void attachment.ensureControl().then((ok) => { if (ok) { surface.setControlled(true); surface.focus(); } });
  }, [interactive, attachment, surface]);
  const active = useRef(false), hold = useRef(false);
  const holding = useCreatorClaim({ terminal, attachment, surface, host, phase: state.phase, canDevelop });
  const onFocusChange = useCallback((value: boolean) => { active.current = value; attachment.setActive(value || hold.current); }, [attachment]);
  useEffect(() => { hold.current = holding; attachment.setActive(active.current || holding); }, [attachment, holding]);
  useTerminalFocus(host, onFocusChange, take);
  const view = terminal.lifecycle === 'running' ? terminalControlView(state, viewerId, canDevelop) : undefined;
  // 启动中（RFC-022 D3）：终端区域中间是步骤条，状态条显示当前段；xterm 照常挂载、照常附着，只是被盖住。
  const startup = terminal.startup?.state === 'running' ? terminal.startup : undefined;
  return <>
    <div className={styles.statusBar}>{info ? <span className={styles.info}>{info}</span> : null}
    <div className={styles.controlLine} data-control={startup ? undefined : view?.tone} role="status" aria-live="polite">
      {startup ? <StageSummary progress={startup} /> : view ? <strong className={styles.controlState}>{controlText(t, view)}</strong> : <span>{t(`devSession.native.attach.${state.phase}`)}</span>}
      {!startup && terminal.protocol === 'opencode' && state.phase === 'ready' ? <span title={t('devSession.native.historyHelp')}>{t(state.controlled ? 'devSession.native.historyControlled' : 'devSession.native.historyReadOnly')}</span> : null}
      {state.truncated ? <span title={t('devSession.native.scrollback')}>{t('devSession.native.bounded')}</span> : null}
      {state.phase === 'error' ? <Button variant="ghost" onClick={() => void attachment.refresh()}>{t('devSession.native.reattach')}</Button> : null}
    </div></div>
    {notices}
    {state.error ? <p className={styles.error} role="status">{state.error}</p> : null}
    <div className={styles.surfaceFrame}>
      <div className={styles.terminalSurface} ref={host} role="region" tabIndex={state.controlled ? -1 : 0} aria-label={t('devSession.native.screen', { id: terminal.agentId.slice(-6) })}
        onPointerDown={take} onKeyDown={state.controlled ? undefined : take} />
      {startup ? <div className={styles.startupPane}><StageProgress progress={startup} title={t('devSession.native.startup.title', { profile: terminal.computeName ?? terminal.compute })} /></div> : null}
    </div>
  </>;
}

function controlText(t: Translate, view: TerminalControlView): string {
  if (view.tone !== 'other') return t(`devSession.native.control.${view.tone}`);
  return t('devSession.native.control.other', { name: view.holder?.name || t('devSession.native.control.unnamed') });
}
