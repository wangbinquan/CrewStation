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
import { canReleaseSession } from '../model/sessionAccess';
import type { StreamState } from '../model/taskStreamSocket';
import { PaneNotice } from './PaneNotice';
import { ReleaseControl } from './ReleaseControl';
import { Card } from '../../../shared/ui/Card';

export interface SessionCardProps {
  readonly session: DevSessionDto;
  readonly stream: StreamState;
  readonly access: SessionAccess;
  readonly release: UseMutationResult<ReleaseDevSessionResult, ApiClientError, boolean>;
  readonly unsavedFile?: string;
  readonly editorBusy?: boolean;
  readonly dataAccessDirty?: boolean;
  readonly dataAccessBusy?: boolean;
  readonly onOpenFile?: (path: string) => void;
  /** 页头「释放会话」的请求与回报，原样交给释放控件（见 `ReleaseControl` 的 `request`）。 */
  readonly releaseRequest?: number;
  readonly onReleaseRequestHandled?: (request: number) => void;
}

function details(session: DevSessionDto, stream: StreamState, access: SessionAccess, t: Translate, locale: string): DefinitionItem[] {
  return [
    { label: t('devSession.session.taskId'), value: <code>{session.taskId}</code> },
    { label: t('devSession.session.branch'), value: <code>{session.branch}</code> },
    { label: t('devSession.session.pod'), value: <code>{session.podName ?? '—'}</code> },
    { label: t('devSession.session.created'), value: formatDateTime(session.createdAt, locale) },
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

/**
 * 会话摘要：状态、任务、TaskRunner 是否已连、归属与释放入口。
 * 释放是针对这个会话的动作，放卡片底部操作条、靠左（2026-09-23 按钮统一）；灰色说明区只留一句后果，不放按钮。
 */
export function SessionCard({ session, stream, access, release, unsavedFile, editorBusy, dataAccessDirty, dataAccessBusy, onOpenFile, releaseRequest, onReleaseRequestHandled }: SessionCardProps): ReactElement {
  const t = useT();
  const { locale } = useI18n();
  const releasable = canReleaseSession(access, session);
  return (
    <Card stacked title={t('devSession.session.details')} footer={releasable ? t('devSession.session.releaseNote') : undefined}
      actions={releasable ? <ReleaseControl projectId={session.projectId} taskId={session.taskId} access={access} release={release} unsavedFile={unsavedFile} editorBusy={editorBusy}
        dataAccessDirty={dataAccessDirty} dataAccessBusy={dataAccessBusy} onOpenFile={onOpenFile} request={releaseRequest} onRequestHandled={onReleaseRequestHandled} /> : undefined}>
      <DefinitionList layout="grid" items={details(session, stream, access, t, locale)} />
      {stream.runnerState !== undefined && stream.runnerState !== 'ready' ? (
        <PaneNotice tone="warning">{t(`devSession.runnerState.${stream.runnerState}`)}</PaneNotice>
      ) : null}
      {session.message !== undefined ? <PaneNotice tone="warning">{session.message}</PaneNotice> : null}
      {session.idleReminderSentAt !== undefined ? (
        <PaneNotice tone="info">{t('devSession.session.idleReminder', { at: formatDateTime(session.idleReminderSentAt, locale) })}</PaneNotice>
      ) : null}
    </Card>
  );
}
