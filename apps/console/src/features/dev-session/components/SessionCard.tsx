import type { ReleaseDevSessionResult } from '@crewstation/api-client';
import type { DevSessionDto } from '@crewstation/contracts';
import type { UseMutationResult } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import type { ApiClientError } from '../../../shared/api/useApi';
import { formatDateTime } from '../../../shared/lib/dateFormat';
import { useI18n } from '../../../shared/lib/useI18n';
import { useT } from '../../../shared/lib/useT';
import type { Translate } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import type { DefinitionItem } from '../../../shared/ui/DefinitionList';
import type { SessionAccess } from '../model/sessionAccess';
import { sessionStateTone } from '../model/stateTone';
import type { StreamState } from '../model/taskStreamSocket';
import { PaneNotice } from './PaneNotice';
import { ReleaseControl } from './ReleaseControl';
import { StreamStatus } from './StreamStatus';
import styles from './SessionCard.module.css';

export interface SessionCardProps {
  readonly session: DevSessionDto;
  readonly stream: StreamState;
  readonly access: SessionAccess;
  readonly release: UseMutationResult<ReleaseDevSessionResult, ApiClientError, boolean>;
}

function details(session: DevSessionDto, stream: StreamState, access: SessionAccess, t: Translate, locale: string): DefinitionItem[] {
  return [
    { label: t('devSession.session.taskId'), value: <code>{session.taskId}</code> },
    { label: t('devSession.session.branch'), value: <code>{session.branch}</code> },
    {
      label: t('devSession.session.runner'),
      value: (
        <Badge tone={stream.runnerConnected ? 'success' : 'warning'}>
          {stream.runnerConnected ? t('devSession.session.runnerOn') : t('devSession.session.runnerOff')}
        </Badge>
      ),
    },
    { label: t('devSession.session.owner'), value: access.isMine ? t('devSession.session.ownerMe', { user: session.createdBy }) : session.createdBy },
    { label: t('devSession.session.lastActivity'), value: formatDateTime(session.lastActivityAt, locale) },
    { label: t('devSession.session.previewHost'), value: <code>{session.previewHost}</code> },
  ];
}

/** 会话摘要：状态、任务、TaskRunner 是否已连、归属与释放入口。 */
export function SessionCard({ session, stream, access, release }: SessionCardProps): ReactElement {
  const t = useT();
  const { locale } = useI18n();
  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <Badge tone={sessionStateTone(session.state)}>{t(`devSession.state.${session.state}`)}</Badge>
          <StreamStatus state={stream} />
        </div>
        <ReleaseControl access={access} release={release} />
      </header>
      <DefinitionList layout="grid" items={details(session, stream, access, t, locale)} />
      {stream.runnerState !== undefined && stream.runnerState !== 'ready' ? (
        <PaneNotice tone="warning">{t(`devSession.runnerState.${stream.runnerState}`)}</PaneNotice>
      ) : null}
      {session.message !== undefined ? <PaneNotice tone="warning">{session.message}</PaneNotice> : null}
      {session.idleReminderSentAt !== undefined ? (
        <PaneNotice tone="info">{t('devSession.session.idleReminder', { at: formatDateTime(session.idleReminderSentAt, locale) })}</PaneNotice>
      ) : null}
    </section>
  );
}
