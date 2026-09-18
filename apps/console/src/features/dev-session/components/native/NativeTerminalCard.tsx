import type { NativeTerminalDto, WorkspaceLayout } from '@crewstation/contracts';
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { ConfirmationPanel } from '../../../../shared/ui/ConfirmationPanel';
import type { TaskStreamChannel } from '../../hooks/useTaskStream';
import { useTaskStream } from '../../hooks/useTaskStream';
import type { StreamState } from '../../model/taskStreamSocket';
import type { WorkspaceLayoutStore } from '../../model/layout/workspaceLayoutStore';
import { moveTerminal, reorderTerminal } from '../../model/layout/workspaceLayout';
import { NativeTerminalView } from './NativeTerminalView';
import styles from './NativeWorkspace.module.css';
import type { ActivityTask } from '../../../../shared/activity/agentActivityStore';
import { activityStatus } from '../../../../shared/activity/agentActivityView';
import { useAgentActivity } from '../../../../shared/activity/AgentActivityProvider';

interface NativeTerminalCardProps {
  readonly terminalId: string; readonly terminal: NativeTerminalDto | undefined; readonly layout: WorkspaceLayout; readonly store: WorkspaceLayoutStore;
  readonly channel: TaskStreamChannel; readonly stream: StreamState; readonly onStop: (id: string) => void; readonly onActivity: () => void; readonly canDevelop: boolean;
  readonly activity?: ActivityTask;
  readonly activitySync?: 'ready' | 'catching-up' | 'unavailable';
  readonly onTerminalChange?: () => void;
  readonly onRetry?: (terminal: NativeTerminalDto) => void;
}

export function NativeTerminalCard(props: NativeTerminalCardProps): ReactElement {
  return props.terminal?.execution ? <ExecutionTerminalCard {...props} /> : <NativeTerminalFrame {...props} />;
}

function ExecutionTerminalCard(props: NativeTerminalCardProps): ReactElement {
  const terminal = props.terminal!, activity = useAgentActivity();
  const ended = terminal.lifecycle === 'ended' || terminal.lifecycle === 'failed';
  const handle = useTaskStream(terminal.execution!.taskId, !ended && !['cleaning', 'finished'].includes(terminal.execution!.state), { replay: 'tail' });
  const { onTerminalChange } = props;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = handle.channel.subscribe((event) => {
      if (event.kind !== 'nativeTerminal' && event.kind !== 'nativeActivity') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { onTerminalChange?.(); void activity.store?.refresh(terminal.taskId); }, 100);
    });
    return () => { stop(); if (timer) clearTimeout(timer); };
  }, [handle.channel, onTerminalChange, activity.store, terminal.taskId]);
  return <NativeTerminalFrame {...props} channel={handle.channel} stream={handle.state} />;
}

function NativeTerminalFrame({ terminalId, terminal, layout, store, channel, stream, onStop, onActivity, canDevelop, activity, activitySync, onRetry }: NativeTerminalCardProps): ReactElement {
  const t = useT();
  const [stopping, setStopping] = useState(false);
  const tabId = layout.tabs.find((tab) => tab.paneOrder.includes(terminalId))?.id ?? layout.activeTabId;
  const label = `CLI ${terminal?.agentId.slice(-6) ?? terminalId.slice(-6)}`;
  const state = activityStatus(terminal, activity?.page?.states.find((state) => state.terminalId === terminalId) ?? terminal?.activity, activity?.page ?? { sync: activitySync ?? 'unavailable', connection: terminal?.connection ?? 'unknown' }, activity?.stale || !stream.runnerConnected);
  return <section className={styles.terminalCard} data-native-terminal={terminalId} tabIndex={-1} onFocusCapture={() => store.update((value) => value.selectedTerminalId === terminalId ? value : { ...value, selectedTerminalId: terminalId })}>
    <header className={styles.terminalHeader}>
      <strong title={terminal?.agentId}>{label}</strong><span className={styles.lifecycle} data-activity={state}>{t(`activity.status.${state}`)}</span>
      {terminal?.lifecycle === 'running' && terminal.connection === 'connected' && stream.runnerConnected && state !== 'ended' ? <small className={styles.lifecycle}>{t('activity.processOnline')}</small> : null}
      <span className={styles.compute}>{terminal?.compute}</span>
      {terminal?.protocol === 'terminal' ? <small title={t('devSession.agents.terminalOnlyHint')}>{t('devSession.agents.terminalOnly')}</small> : null}
      {terminal?.profileRevision ? <small>{t('devSession.agents.profileRevision', { revision: terminal.profileRevision })}</small> : null}
      {terminal?.execution?.profile ? <small title={t('devSession.native.resourcesHint')}>CPU {terminal.execution.profile.cpu} · {terminal.execution.profile.memory}</small> : null}
      <Button variant="ghost" aria-label={t('devSession.native.zoom', { id: label })} onClick={() => store.update((value) => ({ ...value, maximizedTerminalId: value.maximizedTerminalId === terminalId ? null : terminalId }))}>{layout.maximizedTerminalId === terminalId ? '↙' : '↗'}</Button>
      <details className={styles.menu}><summary aria-label={t('devSession.native.options', { id: label })}>···</summary><div className={styles.menuBody}>
        <Button variant="ghost" onClick={() => store.update((value) => reorderTerminal(value, tabId, terminalId, -1))}>{t('devSession.native.earlier')}</Button>
        <Button variant="ghost" onClick={() => store.update((value) => reorderTerminal(value, tabId, terminalId, 1))}>{t('devSession.native.later')}</Button>
        <label>{t('devSession.native.move')}<select value={tabId} onChange={(event) => store.update((value) => moveTerminal(value, terminalId, event.target.value))}>{layout.tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.name}</option>)}</select></label>
        <Button variant="ghost" onClick={() => store.update((value) => moveTerminal(value, terminalId, null))}>{t('devSession.native.hide')}</Button>
        {terminal && canDevelop && !['ended', 'failed'].includes(terminal.lifecycle) ? <Button onClick={() => setStopping(true)}>{t('devSession.native.stop')}</Button> : null}
        {terminal?.lifecycle === 'failed' && onRetry ? <Button onClick={() => onRetry(terminal)}>{t('devSession.native.retryExecution')}</Button> : null}
      </div></details>
    </header>
    {stopping && terminal ? <ConfirmationPanel question={t('devSession.native.stopQuestion', { id: label })} hint={t('devSession.native.stopHint')} confirmLabel={t('devSession.native.stop')} cancelLabel={t('devSession.release.cancel')} onCancel={() => setStopping(false)} onConfirm={() => { onStop(terminal.agentId); setStopping(false); }} /> : null}
    {terminal?.error ? <p className={styles.error}>{terminal.error}</p> : null}
    {terminal?.beforeStart && (terminal.beforeStart.state === 'queued' || terminal.beforeStart.state === 'running') ? <div className={styles.controlLine} role="status">{terminal.beforeStart.state === 'queued' ? t('devSession.native.preparingQueued') : t('devSession.native.preparing', { step: terminal.beforeStart.currentStep ?? '' })}</div> : null}
    {terminal?.beforeStart?.state === 'failed' ? <p className={styles.error}>{t('devSession.native.preparationFailed', { step: terminal.beforeStart.failedStep ?? '' })}</p> : null}
    {terminal?.execution && !['running', 'finished'].includes(terminal.execution.state) && !['ended', 'failed'].includes(terminal.lifecycle) ? <div className={styles.controlLine} role="status">{terminal.execution.message ?? t(`devSession.native.execution.${terminal.execution.state}`)}</div> : null}
    {terminal ? <NativeTerminalView terminal={terminal} channel={channel} stream={stream} onActivity={onActivity} canDevelop={canDevelop} /> : <p className={styles.error}>{t('devSession.native.missing')}</p>}
  </section>;
}
