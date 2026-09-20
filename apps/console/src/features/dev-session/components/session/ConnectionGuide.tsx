import type { DevSessionDto } from '@crewstation/contracts';
import type { ReactNode } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { PaneNotice } from '../PaneNotice';
import { ActionRow } from '../../../../shared/ui/ActionRow';
import { Button } from '../../../../shared/ui/Button';
import { Stack } from '../../../../shared/ui/Stack';
import type { StreamState } from '../../model/taskStreamSocket';
import { sessionConnection } from '../../model/connection/sessionConnection';

export interface ConnectionGuideProps {
  readonly session: DevSessionDto; readonly stream: StreamState;
  readonly refresh: () => Promise<unknown>; readonly refreshing: boolean;
  readonly reconnect: () => void; readonly onEnvironment?: () => void; readonly logs: ReactNode;
}

/** 每一种阻塞都有真实动作；普通断线只检查或重连，不暴露容器替换。 */
export function ConnectionGuide({ session, stream, refresh, refreshing, reconnect, onEnvironment, logs }: ConnectionGuideProps) {
  const t = useT(), status = sessionConnection(session, stream);
  if (status === 'ready') return null;
  const recovery = status === 'protocol' || status === 'failed';
  const reason = recovery || status === 'starting' || status === 'recovering' ? session.connectionIssue?.message ?? session.message : undefined;
  return <Stack>
    <PaneNotice tone={recovery || status === 'unknown' ? 'warning' : 'info'}>
      <strong>{t(`devSession.connection.${status}`)}</strong>{' · '}{t(`devSession.connection.${status}Hint`)}
      {reason ? <span> {reason}</span> : null}
      {status === 'failed' ? <span> {session.taskId} · {t('devSession.failed.worktree')}</span> : null}
    </PaneNotice>
    <ActionRow>
      {status === 'browser' ? <Button variant="primary" onClick={reconnect}>{t('devSession.connection.reconnect')}</Button> : null}
      {onEnvironment ? <Button variant={recovery ? 'primary' : 'secondary'} onClick={onEnvironment}>{t(recovery ? 'devSession.connection.recover' : 'devSession.connection.details')}</Button> : null}
      <Button variant="ghost" disabled={refreshing} onClick={() => void refresh()}>{t(refreshing ? 'devSession.connection.checking' : 'devSession.connection.check')}</Button>
      {logs}
    </ActionRow>
  </Stack>;
}
