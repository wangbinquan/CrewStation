import type { DevSessionDto } from '@crewstation/contracts';
import type { UseMutationResult } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ApiClientError } from '../../../shared/api/useApi';
import { errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { defaultBranchName } from '../model/branchChoice';
import type { BranchesHandle } from '../hooks/useBranches';
import { BranchSelect } from './BranchSelect';
import { Pane } from './Pane';
import { PaneNotice } from './PaneNotice';
import styles from './OpenSessionForm.module.css';

export interface OpenSessionFormProps {
  readonly branches: BranchesHandle;
  readonly open: UseMutationResult<DevSessionDto, ApiClientError, string>;
}

/** 还没有会话时的入口：选分支开一个开发容器。一个项目同时只能有一个。 */
export function OpenSessionForm({ branches, open }: OpenSessionFormProps): ReactElement {
  const t = useT();
  const [picked, setPicked] = useState('');
  // 分支还在加载时 picked 为空，用缺省分支兜底；用户选过之后以选择为准。
  const branch = picked === '' ? defaultBranchName(branches.branches) : picked;
  return (
    <Pane title={t('devSession.open.title')}>
      <p className={styles.hint}>{t('devSession.open.hint')}</p>
      <div className={styles.row}>
        <label className={styles.label} htmlFor="dev-session-branch">
          {t('devSession.open.branch')}
        </label>
        <BranchSelect id="dev-session-branch" branches={branches.branches} value={branch} disabled={branches.isPending} onChange={setPicked} />
        <Button variant="primary" disabled={branch === '' || open.isPending} onClick={() => open.mutate(branch)}>
          {open.isPending ? t('devSession.open.pending') : t('devSession.open.submit')}
        </Button>
      </div>
      {branches.loadError !== null ? <PaneNotice tone="warning">{errorMessage(branches.loadError)}</PaneNotice> : null}
      {open.error !== null ? <PaneNotice tone="warning">{errorMessage(open.error)}</PaneNotice> : null}
    </Pane>
  );
}
