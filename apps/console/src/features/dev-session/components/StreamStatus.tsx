import type { ReactElement } from 'react';
import type { DevSessionState } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { sessionStateTone, streamStatusTone } from '../model/stateTone';
import type { StreamState } from '../model/taskStreamSocket';
import styles from './StreamStatus.module.css';

/** 会话与容器状态优先于浏览器通道；能读回历史不代表开发容器仍可连接。 */
export function StreamStatus({ state, sessionState }: { readonly state: StreamState; readonly sessionState: DevSessionState }): ReactElement {
  const t = useT();
  const lifecycle = sessionState !== 'running';
  const runnerMissing = state.status === 'open' && !state.runnerConnected;
  const runnerStopping = state.status === 'open' && state.runnerConnected && state.runnerState && state.runnerState !== 'ready' ? state.runnerState : undefined;
  const tone = lifecycle ? sessionStateTone(sessionState) : runnerMissing || runnerStopping ? 'warning' : streamStatusTone(state.status);
  const label = lifecycle ? t(`devSession.state.${sessionState}`) : runnerMissing ? t('devSession.stream.runnerOff') : t(`devSession.stream.${runnerStopping ?? state.status}`);
  return (
    <span className={styles.status}>
      <Badge tone={tone}>{label}</Badge>
      {state.attempt > 0 ? <span className={styles.meta}>{t('devSession.stream.attempt', { count: state.attempt })}</span> : null}
      {state.replayed > 0 ? <span className={styles.meta} title={state.replayFromSeq !== undefined ? t('devSession.stream.replayedTailHint') : undefined}>{t(state.replayFromSeq !== undefined ? 'devSession.stream.replayedTail' : 'devSession.stream.replayed', { count: state.replayed })}</span> : null}
      {state.error !== undefined ? <span className={styles.error}>{state.error}</span> : null}
    </span>
  );
}
