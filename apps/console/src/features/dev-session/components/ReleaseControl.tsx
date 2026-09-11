import type { ReleaseDevSessionResult } from '@crewstation/api-client';
import type { UseMutationResult } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ApiClientError } from '../../../shared/api/useApi';
import { errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import type { SessionAccess } from '../model/sessionAccess';
import { ConfirmPanel } from './ConfirmPanel';
import { PaneNotice } from './PaneNotice';
import styles from './ReleaseControl.module.css';

export interface ReleaseControlProps {
  readonly access: SessionAccess;
  readonly release: UseMutationResult<ReleaseDevSessionResult, ApiClientError, boolean>;
}

/**
 * 释放会话：先就地确认，负责人释放他人会话要额外说明这会带 force。
 * 释放结果（未推送的提交）由页面渲染：会话没了之后本组件已经不在树上。
 */
export function ReleaseControl({ access, release }: ReleaseControlProps): ReactElement | null {
  const t = useT();
  const [asking, setAsking] = useState(false);
  if (!access.canRelease) return null;
  if (asking) {
    return (
      <ConfirmPanel
        question={access.needsForce ? t('devSession.release.confirmForce') : t('devSession.release.confirm')}
        hint={t('devSession.release.hint')}
        confirmLabel={t('devSession.release.submit')}
        cancelLabel={t('devSession.release.cancel')}
        busy={release.isPending}
        onConfirm={() => {
          setAsking(false);
          release.mutate(access.needsForce);
        }}
        onCancel={() => setAsking(false)}
      />
    );
  }
  return (
    <div className={styles.control}>
      <Button onClick={() => setAsking(true)} disabled={release.isPending}>
        {release.isPending ? t('devSession.release.pending') : t('devSession.release.action')}
      </Button>
      {release.error !== null ? <PaneNotice tone="warning">{errorMessage(release.error)}</PaneNotice> : null}
    </div>
  );
}
