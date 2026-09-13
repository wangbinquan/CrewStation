import type { NativeTerminalDto, WorkspaceLayout } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { ConfirmationPanel } from '../../../../shared/ui/ConfirmationPanel';
import type { TaskStreamChannel } from '../../hooks/useTaskStream';
import type { StreamState } from '../../model/taskStreamSocket';
import type { WorkspaceLayoutStore } from '../../model/layout/workspaceLayoutStore';
import { moveTerminal, reorderTerminal } from '../../model/layout/workspaceLayout';
import { NativeTerminalView } from './NativeTerminalView';
import styles from './NativeWorkspace.module.css';
import type { ActivityTask } from '../../../../shared/activity/agentActivityStore';
import { activityStatus } from '../../../../shared/activity/agentActivityView';

export function NativeTerminalCard({ terminalId, terminal, layout, store, channel, stream, onStop, onActivity, canDevelop, activity, activitySync }: {
  readonly terminalId: string; readonly terminal: NativeTerminalDto | undefined; readonly layout: WorkspaceLayout; readonly store: WorkspaceLayoutStore;
  readonly channel: TaskStreamChannel; readonly stream: StreamState; readonly onStop: (id: string) => void; readonly onActivity: () => void; readonly canDevelop: boolean;
  readonly activity?: ActivityTask;
  readonly activitySync?: 'ready' | 'catching-up' | 'unavailable';
}): ReactElement {
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
      <Button variant="ghost" aria-label={t('devSession.native.zoom', { id: label })} onClick={() => store.update((value) => ({ ...value, maximizedTerminalId: value.maximizedTerminalId === terminalId ? null : terminalId }))}>{layout.maximizedTerminalId === terminalId ? '↙' : '↗'}</Button>
      <details className={styles.menu}><summary aria-label={t('devSession.native.options', { id: label })}>···</summary><div className={styles.menuBody}>
        <Button variant="ghost" onClick={() => store.update((value) => reorderTerminal(value, tabId, terminalId, -1))}>{t('devSession.native.earlier')}</Button>
        <Button variant="ghost" onClick={() => store.update((value) => reorderTerminal(value, tabId, terminalId, 1))}>{t('devSession.native.later')}</Button>
        <label>{t('devSession.native.move')}<select value={tabId} onChange={(event) => store.update((value) => moveTerminal(value, terminalId, event.target.value))}>{layout.tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.name}</option>)}</select></label>
        <Button variant="ghost" onClick={() => store.update((value) => moveTerminal(value, terminalId, null))}>{t('devSession.native.hide')}</Button>
        {terminal && canDevelop && !['ended', 'failed'].includes(terminal.lifecycle) ? <Button onClick={() => setStopping(true)}>{t('devSession.native.stop')}</Button> : null}
      </div></details>
    </header>
    {stopping && terminal ? <ConfirmationPanel question={t('devSession.native.stopQuestion', { id: label })} hint={t('devSession.native.stopHint')} confirmLabel={t('devSession.native.stop')} cancelLabel={t('devSession.release.cancel')} onCancel={() => setStopping(false)} onConfirm={() => { onStop(terminal.agentId); setStopping(false); }} /> : null}
    {terminal?.error ? <p className={styles.error}>{terminal.error}</p> : null}
    {terminal ? <NativeTerminalView terminal={terminal} channel={channel} stream={stream} onActivity={onActivity} canDevelop={canDevelop} /> : <p className={styles.error}>{t('devSession.native.missing')}</p>}
  </section>;
}
