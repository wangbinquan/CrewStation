import type { ReleaseDevSessionResult } from '@crewstation/api-client';
import type { UseMutationResult } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ApiClientError } from '../../../shared/api/useApi';
import { errorMessage, useApiMutation } from '../../../shared/api/useApi';
import { api } from '../../../shared/api/client';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { ConfirmationPanel } from '../../../shared/ui/ConfirmationPanel';
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
}

/**
 * 释放会话：先就地确认，负责人释放他人会话要额外说明这会带 force。
 * 释放结果（未推送的提交）由页面渲染：会话没了之后本组件已经不在树上。
 */
export function ReleaseControl({ projectId, taskId, access, release }: ReleaseControlProps): ReactElement | null {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const inspection = useApiMutation(() => api.devSession.workspaceStatus(projectId));
  const inspect = (): void => { inspection.reset(); inspection.mutate(undefined); };
  if (!access.canRelease) return null;
  if (asking) {
    return (
      <ConfirmationPanel
        question={access.needsForce ? t('devSession.release.confirmForce') : t('devSession.release.confirm')}
        hint={t('devSession.release.hint')}
        confirmLabel={t('devSession.release.submit')}
        cancelLabel={t('devSession.release.cancel')}
        busy={release.isPending}
        confirmDisabled={inspection.isPending || (inspection.data !== undefined && inspection.data.taskId !== taskId)}
        onConfirm={() => {
          setAsking(false);
          release.mutate(access.needsForce);
        }}
        onCancel={() => setAsking(false)}
      >
        <QueryStatus isPending={inspection.isPending} error={inspection.error} loadingKey="devSession.workspace.checking" />
        {inspection.error ? <PaneNotice tone="warning">{t('devSession.release.unknown')}</PaneNotice> : null}
        {inspection.data ? <WorkspaceInspection workspace={inspection.data} /> : null}
        {inspection.data !== undefined && inspection.data.taskId !== taskId ? <PaneNotice tone="warning">{t('devSession.workspace.sessionChanged')}</PaneNotice> : null}
        <Button variant="ghost" onClick={inspect} disabled={inspection.isPending || release.isPending}>{t('devSession.workspace.recheck')}</Button>
      </ConfirmationPanel>
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
