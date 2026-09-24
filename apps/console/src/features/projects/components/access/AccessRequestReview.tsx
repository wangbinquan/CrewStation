import type { AppAccessRequestDto, AppAccessRequestState } from '@crewstation/contracts';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { RequestPageControls } from '../../../../shared/admin/RequestPageControls';
import { errorMessage } from '../../../../shared/api/useApi';
import { useDateText } from '../../../../shared/lib/useDateText';
import { useDraftTarget } from '../../../../shared/lib/useDraftTarget';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { ActionRow } from '../../../../shared/ui/ActionRow';
import { Badge } from '../../../../shared/ui/Badge';
import type { BadgeTone } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { ConfirmationDialog } from '../../../../shared/ui/dialog/ConfirmationDialog';
import type { AccessRequestScope } from '../../model/useAccessRequestReview';
import { useAccessRequestReview } from '../../model/useAccessRequestReview';
import { RejectAccessForm } from './RejectAccessForm';
import styles from './AccessRequests.module.css';

const TONE: Readonly<Record<AppAccessRequestState, BadgeTone>> = { pending: 'info', approved: 'success', rejected: 'warning' };

export interface AccessRequestReviewProps {
  readonly scope: AccessRequestScope;
  readonly title: string;
  readonly empty: string;
  readonly hint?: string;
  /** 管理空间的全局清单：每条带应用名并按状态分页；项目内的待处理清单不给。 */
  readonly onPage?: (cursor?: string) => void;
}

/**
 * 使用申请的清单与审批（2026-09-24 裁定）：同意即加为「用户」；拒绝在弹窗里写可选理由，关窗理由留着，改拒别人先确认。
 * 应用展示页（项目内待处理）与管理空间「申请审批」共用。
 */
export function AccessRequestReview({ scope, title, empty, hint, onPage }: AccessRequestReviewProps): ReactElement {
  const t = useT(), { requests, decide } = useAccessRequestReview(scope);
  const reject = useDraftTarget<AppAccessRequestDto>((current, next) => current.id === next.id), target = reject.target;
  const items = requests.data?.items ?? [], busy = decide.isPending, nameOf = (r: AppAccessRequestDto) => r.requestedByName ?? r.requestedBy;
  const rejecting = decide.variables?.approve === false;
  // 全局清单的翻页条放在卡片外，与同页的 API 申请一栏同一种排法。
  return <>{onPage ? <RequestPageControls scope={title} cursor={scope.cursor} nextCursor={requests.data?.nextCursor} busy={requests.isFetching || busy}
    count={requests.isPending || requests.error ? undefined : items.length} updatedAt={requests.dataUpdatedAt} onPage={onPage} /> : null}
  <Card stacked compact title={title}>
    <UnsavedChangesGuard dirty={reject.dirty || busy} scope={t('projects.access.title')} />
    {hint ? <p className={styles.muted}>{hint}</p> : null}
    {decide.isSuccess ? <ActionNote tone="success">{t(decide.data.state === 'approved' ? 'projects.access.approvedNote' : 'projects.access.rejectedNote', { name: nameOf(decide.data) })}</ActionNote> : null}
    {decide.isError && !(rejecting && reject.open) ? <ActionNote tone="error">{t('projects.access.error', { message: errorMessage(decide.error) })}</ActionNote> : null}
    <QueryStatus isPending={requests.isPending} error={requests.error} />
    {!requests.isPending && !requests.error && items.length === 0 ? <p className={styles.muted}>{empty}</p> : null}
    {items.length > 0 ? <ul className={styles.list}>{items.map((request) => <AccessRequestRow key={request.id} request={request} showApp={!!onPage} busy={busy}
      onApprove={() => decide.mutate({ request, approve: true })} onReject={() => reject.select(request)} />)}</ul> : null}
    {!onPage && requests.data?.nextCursor ? <p className={styles.muted}>{t('projects.access.more')}</p> : null}
    {reject.switching && target ? <ConfirmationDialog question={t('ui.draft.question', { scope: t('projects.access.draftScope', { name: nameOf(target) }) })} hint={t('ui.draft.hint')}
      confirmLabel={t('ui.draft.leave')} cancelLabel={t('ui.draft.stay')} focus="cancel" onConfirm={reject.confirm} onCancel={reject.keep} /> : null}
    {reject.hasDraft && target ? <RejectAccessForm key={reject.sequence} request={target} open={reject.open} busy={busy} {...(decide.isError && rejecting ? { error: errorMessage(decide.error) } : {})}
      onDirtyChange={reject.dirtyChanged} onClose={reject.hide} onClear={reject.clear}
      onSubmit={(decision) => decide.mutate({ request: target, approve: false, ...(decision ? { decision } : {}) }, { onSuccess: reject.close })} /> : null}
  </Card></>;
}

interface RowProps {
  readonly request: AppAccessRequestDto;
  readonly showApp: boolean;
  readonly busy: boolean;
  readonly onApprove: () => void;
  readonly onReject: () => void;
}

/** 一条申请：谁、哪个应用（全局清单）、何时、理由；已处理的写谁在何时怎么处理的。 */
function AccessRequestRow({ request, showApp, busy, onApprove, onReject }: RowProps): ReactElement {
  const t = useT(), dateText = useDateText(), name = request.requestedByName ?? request.requestedBy;
  return <li className={styles.item}>
    <div className={styles.summary}>
      <div className={styles.head}><strong title={request.requestedBy}>{name}</strong>{request.requestedByEmail ? <span className={styles.muted}>{request.requestedByEmail}</span> : null}
        <Badge tone={TONE[request.state]}>{t(`projects.access.state.${request.state}`)}</Badge></div>
      {showApp ? <p>{request.project ? <Link to="/projects/$projectId/settings" params={{ projectId: request.projectId }} search={{ tab: 'visibility' }}>{request.project.name}</Link> : <code>{request.projectId}</code>}</p> : null}
      <p className={styles.muted}>{t('projects.access.requestedAt', { time: dateText(request.createdAt) })}</p>
      <p>{request.reason ? t('projects.access.reason', { reason: request.reason }) : t('projects.access.noReason')}</p>
      {request.state !== 'pending' ? <p className={styles.muted}>{t('projects.access.decided', { name: request.decidedByName ?? request.decidedBy ?? '—', time: dateText(request.decidedAt), state: t(`projects.access.state.${request.state}`) })}
        {request.decision ? ` · ${t('projects.access.decisionText', { decision: request.decision })}` : ''}</p> : null}
    </div>
    {request.state === 'pending' ? <ActionRow>
      <Button variant="primary" size="small" disabled={busy} aria-label={t('projects.access.approveFor', { name })} onClick={onApprove}>{t('projects.access.approve')}</Button>
      <Button size="small" disabled={busy} aria-haspopup="dialog" aria-label={t('projects.access.rejectFor', { name })} onClick={onReject}>{t('projects.access.reject')}</Button>
    </ActionRow> : null}
  </li>;
}
