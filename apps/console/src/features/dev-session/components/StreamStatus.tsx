import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { streamStatusTone } from '../model/stateTone';
import type { StreamState } from '../model/taskStreamSocket';
import styles from './StreamStatus.module.css';

/** 浏览器到任务的连接状态；重连次数与回放条数一起给出，断线时用户知道发生了什么。 */
export function StreamStatus({ state }: { readonly state: StreamState }): ReactElement {
  const t = useT();
  return (
    <span className={styles.status}>
      <Badge tone={streamStatusTone(state.status)}>{t(`devSession.stream.${state.status}`)}</Badge>
      {state.attempt > 0 ? <span className={styles.meta}>{t('devSession.stream.attempt', { count: state.attempt })}</span> : null}
      {state.replayed > 0 ? <span className={styles.meta}>{t('devSession.stream.replayed', { count: state.replayed })}</span> : null}
      {state.error !== undefined ? <span className={styles.error}>{state.error}</span> : null}
    </span>
  );
}
