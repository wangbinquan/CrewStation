import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';

/** 发布与切流按钮占位：接入平台 API 前保持禁用，悬停提示说明各自的语义。 */
export function PublishControls(): ReactElement {
  const t = useT();
  return (
    <>
      <Button variant="primary" disabled title={t('projects.actions.publishHint')}>
        {t('projects.actions.publish')}
      </Button>
      <Button disabled title={t('projects.actions.switchTrafficHint')}>
        {t('projects.actions.switchTraffic')}
      </Button>
    </>
  );
}
