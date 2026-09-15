import type { NativeTerminalDto } from '@crewstation/contracts';
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

export function NativeTerminalView({ terminal, channel, stream, onActivity, canDevelop }: { readonly terminal: NativeTerminalDto; readonly channel: TaskStreamChannel; readonly stream: StreamState; readonly onActivity: () => void; readonly canDevelop: boolean }): ReactElement {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const activity = useRef(onActivity);
  useEffect(() => { activity.current = onActivity; }, [onActivity]);
  const { surface, attachment } = useMemo(() => {
    const surface = new NativeTerminalSurface();
    return { surface, attachment: new NativeTerminalAttachment(channel, terminal.terminalId, terminal.runnerId, surface) };
  }, [channel, terminal.terminalId, terminal.runnerId]);
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
      {state.truncated ? <span title={t('devSession.native.scrollback')}>{t('devSession.native.bounded')}</span> : null}
      <Button variant="ghost" disabled={!canDevelop || state.phase !== 'ready' || terminal.lifecycle !== 'running' || state.controlled} onClick={() => void attachment.claim().then((ok) => { if (ok) { surface.setControlled(true); surface.focus(); } })}>{t(state.controlled ? 'devSession.native.controlling' : 'devSession.native.claim')}</Button>
      {state.phase === 'error' ? <Button variant="ghost" onClick={() => void attachment.refresh()}>{t('devSession.native.reattach')}</Button> : null}
    </div>
    {state.error ? <p className={styles.error} role="status">{state.error}</p> : null}
    <div className={styles.terminalSurface} ref={host} role="region" tabIndex={state.controlled ? -1 : 0} aria-label={t('devSession.native.screen', { id: terminal.agentId.slice(-6) })} />
  </>;
}
