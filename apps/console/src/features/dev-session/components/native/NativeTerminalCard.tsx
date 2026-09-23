import type { NativeTerminalDto } from '@crewstation/contracts';
import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import type { TaskStreamChannel } from '../../hooks/useTaskStream';
import { useTaskStream } from '../../hooks/useTaskStream';
import type { StreamState } from '../../model/taskStreamSocket';
import { nativeTerminalStatus } from '../../model/native/nativeTerminalStatus';
import { NativeTerminalView } from './NativeTerminalView';
import styles from './NativeWorkspace.module.css';
import type { ActivityTask } from '../../../../shared/activity/agentActivityStore';
import { useAgentActivity } from '../../../../shared/activity/AgentActivityProvider';

interface NativeTerminalCardProps {
  readonly terminalId: string; readonly terminal: NativeTerminalDto | undefined; readonly name: string;
  readonly channel: TaskStreamChannel; readonly stream: StreamState; readonly onActivity: () => void; readonly canDevelop: boolean;
  readonly activity?: ActivityTask;
  readonly activitySync?: 'ready' | 'catching-up' | 'unavailable';
  readonly onTerminalChange?: () => void;
  readonly onRetry?: (terminal: NativeTerminalDto) => void;
  /** 当前用户，输入控制的状态条据此区分「自己另一个窗口」与别人。 */
  readonly viewerId?: string;
}

/** 标签组里当前标签的画面：终端上方一条细信息条（轮次状态 · 档位 · 资源 · 谁在输入），其下是准备与失败说明、原生终端。 */
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

function NativeTerminalFrame({ terminalId, terminal, name, channel, stream, onActivity, canDevelop, activity, activitySync, onRetry, viewerId }: NativeTerminalCardProps): ReactElement {
  const t = useT();
  const state = nativeTerminalStatus(terminal, terminalId, activity, activitySync, !stream.runnerConnected);
  const info = <>
    {terminal?.protocol !== 'terminal' || state !== 'unknown' ? <span className={styles.lifecycle} data-activity={state}>{t(`activity.status.${state}`)}</span> : null}
    {terminal?.lifecycle === 'running' && terminal.connection === 'connected' && stream.runnerConnected && state !== 'ended' ? <small>{t('activity.processOnline')}</small> : null}
    {terminal ? <span className={styles.compute} title={terminal.computeName ?? terminal.compute}>{terminal.computeName ?? terminal.compute}</span> : null}
    {terminal?.protocol === 'terminal' ? <small title={t('devSession.agents.terminalOnlyHint')}>{t('devSession.agents.terminalOnly')}</small> : null}
    {terminal?.profileRevision ? <small>{t('devSession.agents.profileRevision', { revision: terminal.profileRevision })}</small> : null}
    {terminal?.execution?.profile ? <small title={t('devSession.native.resourcesHint')}>CPU {terminal.execution.profile.cpu} · {terminal.execution.profile.memory}</small> : null}
  </>;
  const notices = <>
    {terminal?.error ? <p className={styles.error}>{terminal.error}</p> : null}
    {terminal?.lifecycle === 'failed' && onRetry ? <div className={styles.controlLine}><Button size="small" onClick={() => onRetry(terminal)}>{t('devSession.native.retryExecution')}</Button></div> : null}
    {terminal?.beforeStart && (terminal.beforeStart.state === 'queued' || terminal.beforeStart.state === 'running') ? <div className={styles.controlLine} role="status">{terminal.beforeStart.state === 'queued' ? t('devSession.native.preparingQueued') : t('devSession.native.preparing', { step: terminal.beforeStart.currentStep ?? '' })}</div> : null}
    {terminal?.beforeStart?.state === 'failed' ? <p className={styles.error}>{t('devSession.native.preparationFailed', { step: terminal.beforeStart.failedStep ?? '' })}</p> : null}
    {terminal?.execution && !['running', 'finished'].includes(terminal.execution.state) && !['ended', 'failed'].includes(terminal.lifecycle) ? <div className={styles.controlLine} role="status">{terminal.execution.message ?? t(`devSession.native.execution.${terminal.execution.state}`)}</div> : null}
  </>;
  return <section className={styles.terminalCard} data-native-terminal={terminalId} tabIndex={-1} aria-label={name}>
    {terminal ? <NativeTerminalView terminal={terminal} channel={channel} stream={stream} onActivity={onActivity} canDevelop={canDevelop} viewerId={viewerId} info={info} notices={notices} />
      : <><div className={styles.statusBar}><span className={styles.info}>{info}</span></div><p className={styles.error}>{t('devSession.native.missing')}</p></>}
  </section>;
}
