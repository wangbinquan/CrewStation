import type { NativeTerminalDto } from '@crewstation/contracts';
import { NativeTerminalSnapshotDtoSchema } from '@crewstation/contracts';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import type { TaskStreamChannel } from '../../hooks/useTaskStream';
import type { StreamState } from '../../model/taskStreamSocket';
import { NativeTerminalAttachment } from '../../model/native/nativeTerminalAttachment';
import { NativeTerminalSurface } from '../../model/native/nativeTerminalSurface';
import styles from './NativeWorkspace.module.css';
import '@xterm/xterm/css/xterm.css';
import { api } from '../../../../shared/api/client';
import { errorMessage, useApiQuery } from '../../../../shared/api/useApi';

interface NativeTerminalViewProps { readonly terminal: NativeTerminalDto; readonly channel: TaskStreamChannel; readonly stream: StreamState; readonly onActivity: () => void; readonly canDevelop: boolean }

export function NativeTerminalView(props: NativeTerminalViewProps): ReactElement {
  return props.terminal.execution && ['ended', 'failed'].includes(props.terminal.lifecycle) ? <SavedNativeTerminalView terminal={props.terminal} /> : <LiveNativeTerminalView {...props} />;
}

function SavedNativeTerminalView({ terminal }: Pick<NativeTerminalViewProps, 'terminal'>): ReactElement {
  const t = useT(), host = useRef<HTMLDivElement>(null), surface = useMemo(() => new NativeTerminalSurface(terminal.protocol), [terminal.protocol]);
  const screen = useApiQuery(['tasks', terminal.taskId, 'native-screen', terminal.agentId], async () => {
    const result = NativeTerminalSnapshotDtoSchema.parse(await api.devSession.getNativeTerminalSnapshot(terminal.taskId, terminal.agentId));
    if (result.snapshot && (result.snapshot.terminalId !== terminal.terminalId || result.snapshot.runnerId !== terminal.runnerId)) throw new Error(t('devSession.native.screenMismatch'));
    return result;
  }, { refetchIntervalMs: terminal.finalScreen === 'pending' ? 2000 : undefined });
  useEffect(() => { if (host.current) surface.mount(host.current, () => {}, () => {}); return () => surface.dispose(); }, [surface]);
  useEffect(() => { if (screen.data?.snapshot) void surface.restore(screen.data.snapshot); }, [surface, screen.data]);
  return <>
    <div className={styles.controlLine}><span>{t(`devSession.native.finalScreen.${screen.data?.status ?? 'pending'}`)}</span>{screen.data?.snapshot?.truncated ? <span title={t('devSession.native.scrollback')}>{t('devSession.native.bounded')}</span> : null}</div>
    {screen.error ? <p className={styles.error} role="status">{errorMessage(screen.error)}<Button onClick={() => void screen.refetch()}>{t('devSession.native.reattach')}</Button></p> : null}
    <div className={styles.terminalSurface} ref={host} role="region" tabIndex={0} aria-label={t('devSession.native.screen', { id: terminal.agentId.slice(-6) })} />
  </>;
}

function LiveNativeTerminalView({ terminal, channel, stream, onActivity, canDevelop }: NativeTerminalViewProps): ReactElement {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const activity = useRef(onActivity);
  useEffect(() => { activity.current = onActivity; }, [onActivity]);
  const { surface, attachment } = useMemo(() => {
    const surface = new NativeTerminalSurface(terminal.protocol);
    return { surface, attachment: new NativeTerminalAttachment(channel, terminal.terminalId, terminal.runnerId, surface) };
  }, [channel, terminal.terminalId, terminal.runnerId, terminal.protocol]);
  const state = useSyncExternalStore(attachment.subscribe, attachment.getState);
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
  return <>
    <div className={styles.controlLine}>
      <span>{t(`devSession.native.attach.${state.phase}`)}</span>
      {terminal.protocol === 'opencode' && state.phase === 'ready' ? <span title={t('devSession.native.historyHelp')}>{t(state.controlled ? 'devSession.native.historyControlled' : 'devSession.native.historyReadOnly')}</span> : null}
      {state.truncated ? <span title={t('devSession.native.scrollback')}>{t('devSession.native.bounded')}</span> : null}
      <Button variant="ghost" disabled={!canDevelop || state.phase !== 'ready' || terminal.lifecycle !== 'running' || state.controlled} onClick={() => void attachment.claim().then((ok) => { if (ok) { surface.setControlled(true); surface.focus(); } })}>{t(state.controlled ? 'devSession.native.controlling' : 'devSession.native.claim')}</Button>
      {state.phase === 'error' ? <Button variant="ghost" onClick={() => void attachment.refresh()}>{t('devSession.native.reattach')}</Button> : null}
    </div>
    {state.error ? <p className={styles.error} role="status">{state.error}</p> : null}
    <div className={styles.terminalSurface} ref={host} role="region" tabIndex={state.controlled ? -1 : 0} aria-label={t('devSession.native.screen', { id: terminal.agentId.slice(-6) })} />
  </>;
}
