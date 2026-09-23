import type { DevSessionDto, OpenDevSessionRequest } from '@crewstation/contracts';
import type { UseMutationResult } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ApiClientError } from '../../../shared/api/useApi';
import { errorMessage, retryableReadError } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { ConfirmationPanel } from '../../../shared/ui/ConfirmationPanel';
import { defaultBranchName } from '../model/branchChoice';
import type { BranchesHandle } from '../hooks/useBranches';
import { BranchSelect } from './BranchSelect';
import { Pane } from './Pane';
import { PaneNotice } from './PaneNotice';
import styles from './OpenSessionForm.module.css';

export interface OpenSessionFormProps {
  readonly branches: BranchesHandle;
  /** 与页面共用一个开会话请求（表单只传分支；失败后「重试」另带 restartOf）。 */
  readonly open: UseMutationResult<DevSessionDto, ApiClientError, string | OpenDevSessionRequest>;
  readonly previousTaskId?: string;
}

/** 还没有会话时的入口：选分支开一个开发容器。一个项目同时只能有一个。 */
export function OpenSessionForm({ branches, open, previousTaskId }: OpenSessionFormProps): ReactElement {
  const t = useT();
  const [picked, setPicked] = useState('');
  const [confirmedBranch, setConfirmedBranch] = useState<string>();
  const confirmation = useRef<HTMLDivElement>(null);
  useEffect(() => { if (confirmedBranch !== undefined) confirmation.current?.querySelector<HTMLButtonElement>('button:last-child')?.focus(); }, [confirmedBranch]);
  // 分支还在加载时 picked 为空，用缺省分支兜底；用户选过之后以选择为准。
  const branch = picked === '' ? defaultBranchName(branches.branches) : picked;
  return (
    <Pane title={t('devSession.open.title')}>
      <p className={styles.hint}>{t('devSession.open.hint')}</p>
      <div className={styles.row}>
        <label className={styles.label} htmlFor="dev-session-branch">
          {t('devSession.open.branch')}
        </label>
        <BranchSelect id="dev-session-branch" branches={branches.branches} value={branch} disabled={branches.isPending || open.isPending || confirmedBranch !== undefined} onChange={setPicked} />
        <Button variant="primary" disabled={branch === '' || branches.isPending || branches.loadError !== null || open.isPending || confirmedBranch !== undefined} onClick={() => previousTaskId ? setConfirmedBranch(branch) : open.mutate(branch)}>
          {open.isPending ? t('devSession.open.pending') : t(previousTaskId ? 'devSession.failed.open' : 'devSession.open.submit')}
        </Button>
      </div>
      {confirmedBranch !== undefined ? <div ref={confirmation}><ConfirmationPanel question={t('devSession.failed.question', { taskId: previousTaskId ?? '', branch: confirmedBranch })}
        hint={t('devSession.failed.newWorkspace')} confirmLabel={t('devSession.failed.confirm')} cancelLabel={t('devSession.failed.cancel')}
        busy={open.isPending} confirmDisabled={branches.loadError !== null || branches.isPending}
        onConfirm={() => { open.mutate(confirmedBranch); setConfirmedBranch(undefined); }} onCancel={() => setConfirmedBranch(undefined)} /></div> : null}
      {branches.loadError !== null ? <PaneNotice tone="warning">{errorMessage(branches.loadError)}{retryableReadError(branches.loadError) ? ` ${t('ui.status.autoRetry')}` : ''}</PaneNotice> : null}
      {!branches.isPending && !branches.loadError && branches.branches.length === 0 ? <PaneNotice tone="info">{t('devSession.open.noBranches')}</PaneNotice> : null}
      {open.error !== null ? <PaneNotice tone="warning">{errorMessage(open.error)}</PaneNotice> : null}
    </Pane>
  );
}
