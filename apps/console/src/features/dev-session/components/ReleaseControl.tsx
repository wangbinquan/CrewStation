import type { ReleaseDevSessionResult } from '@crewstation/api-client';
import type { WorkspaceStatusDto } from '@crewstation/contracts';
import type { UseMutationResult } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ApiClientError } from '../../../shared/api/useApi';
import { errorMessage, useApiMutation } from '../../../shared/api/useApi';
import { api } from '../../../shared/api/client';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { ConfirmationPanel } from '../../../shared/ui/ConfirmationPanel';
import { ConfirmDialog } from '../../../shared/ui/dialog/ConfirmDialog';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import type { SessionAccess } from '../model/sessionAccess';
import { PaneNotice } from './PaneNotice';
import { WorkspaceInspection } from './workspace/WorkspaceInspection';
import styles from './ReleaseControl.module.css';

export interface ReleaseControlProps {
  readonly projectId: string;
  readonly taskId: string;
  readonly access: SessionAccess;
  readonly release: UseMutationResult<ReleaseDevSessionResult, ApiClientError, boolean>;
  readonly unsavedFile?: string;
  readonly editorBusy?: boolean;
  readonly dataAccessDirty?: boolean;
  readonly dataAccessBusy?: boolean;
  readonly onOpenFile?: (path: string) => void;
}

/**
 * 释放前要不要输入 discard（2026-09-23 作者裁定）：有未提交文件或未推送提交、页面上有没保存的输入、
 * 工作区检查失败或结果不可用时都算；只有确认干净才沿用页内确认直接释放。
 */
function needsDiscard(workspace: WorkspaceStatusDto | undefined, failed: boolean, unsavedFile: string | undefined, dataAccessDirty: boolean): boolean {
  if (failed || workspace === undefined || workspace.status === 'unavailable' || unsavedFile !== undefined || dataAccessDirty) return true;
  return workspace.uncommittedCount > 0 || workspace.unpushed.status === 'unavailable' || workspace.unpushed.count > 0;
}

/**
 * 释放会话：先就地确认，负责人释放他人会话要额外说明这会带 force；工作区不干净时再弹窗，输入 discard 才释放。
 * 释放结果（未推送的提交）由页面渲染：会话没了之后本组件已经不在树上。
 */
export function ReleaseControl({ projectId, taskId, access, release, unsavedFile, editorBusy = false, dataAccessDirty, dataAccessBusy = false, onOpenFile }: ReleaseControlProps): ReactElement | null {
  const t = useT();
  const [asking, setAsking] = useState(false), [discarding, setDiscarding] = useState(false);
  const inspection = useApiMutation(() => api.devSession.workspaceStatus(projectId));
  const inspect = (): void => { inspection.reset(); inspection.mutate(undefined); };
  if (!access.canRelease) return null;
  const blocked = editorBusy || dataAccessBusy || inspection.isPending || (inspection.data !== undefined && inspection.data.taskId !== taskId);
  const question = access.needsForce ? t('devSession.release.confirmForce') : t('devSession.release.confirm');
  const confirmRelease = (): void => {
    if (blocked || release.isPending) return;
    setDiscarding(false);
    setAsking(false);
    release.mutate(access.needsForce);
  };
  if (asking) {
    return (
      <>
      <ConfirmationPanel
        question={question}
        hint={t('devSession.release.hint')}
        confirmLabel={t('devSession.release.submit')}
        cancelLabel={t('devSession.release.cancel')}
        busy={release.isPending}
        confirmDisabled={blocked}
        onConfirm={() => { if (needsDiscard(inspection.data, inspection.error !== null, unsavedFile, dataAccessDirty === true)) setDiscarding(true); else confirmRelease(); }}
        onCancel={() => setAsking(false)}
      >
        {unsavedFile ? <PaneNotice tone="warning">{t('devSession.release.editorDraft', { path: unsavedFile })}</PaneNotice> : null}
        {editorBusy ? <PaneNotice tone="info">{t('devSession.release.editorBusy')}</PaneNotice> : null}
        {dataAccessDirty ? <PaneNotice tone="warning">{t('devSession.release.dataDraft')}</PaneNotice> : null}
        {dataAccessBusy ? <PaneNotice tone="info">{t('devSession.release.dataBusy')}</PaneNotice> : null}
        <QueryStatus isPending={inspection.isPending} error={inspection.error} loadingKey="devSession.workspace.checking" />
        {inspection.error ? <PaneNotice tone="warning">{t('devSession.release.unknown')}</PaneNotice> : null}
        {inspection.data ? <WorkspaceInspection workspace={inspection.data} onOpenFile={onOpenFile && !editorBusy && !release.isPending && inspection.data.taskId === taskId ? (file) => { setAsking(false); onOpenFile(file); } : undefined} /> : null}
        {inspection.data !== undefined && inspection.data.taskId !== taskId ? <PaneNotice tone="warning">{t('devSession.workspace.sessionChanged')}</PaneNotice> : null}
        <Button variant="ghost" onClick={inspect} disabled={inspection.isPending || release.isPending}>{t('devSession.workspace.recheck')}</Button>
      </ConfirmationPanel>
      {discarding ? <ConfirmDialog title={t('devSession.release.action')} question={question} confirmWord="discard" confirmLabel={t('devSession.release.discardSubmit')} cancelLabel={t('devSession.release.cancel')}
        confirmDisabled={blocked} onConfirm={confirmRelease} onCancel={() => setDiscarding(false)}>
        <p>{t('devSession.release.discardHint')}</p>
        {unsavedFile ? <PaneNotice tone="warning">{t('devSession.release.editorDraft', { path: unsavedFile })}</PaneNotice> : null}
        {dataAccessDirty ? <PaneNotice tone="warning">{t('devSession.release.dataDraft')}</PaneNotice> : null}
        {inspection.error ? <PaneNotice tone="warning">{t('devSession.release.unknown')}</PaneNotice> : null}
        {inspection.data ? <WorkspaceInspection workspace={inspection.data} /> : null}
      </ConfirmDialog> : null}
      </>
    );
  }
  return (
    <div className={styles.control}>
      <Button onClick={() => { setAsking(true); inspect(); }} disabled={release.isPending}>
        {release.isPending ? t('devSession.release.pending') : t('devSession.release.action')}
      </Button>
      {release.error !== null ? <PaneNotice tone="warning">{errorMessage(release.error)}</PaneNotice> : null}
    </div>
  );
}
