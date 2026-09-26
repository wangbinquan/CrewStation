import { useState } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiMutation } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { ConfirmDialog } from '../../../../shared/ui/dialog/ConfirmDialog';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';

/** 口令不出现在响应或界面；服务端在启动互斥下检查空闲，失败可重新提交同一次轮换。 */
export function DataCredentialRotation({ id, projectId, environment, disabled }: { readonly id: string; readonly projectId: string; readonly environment: string; readonly disabled: boolean }): ReactElement {
  const t = useT(), [open, setOpen] = useState(false), [done, setDone] = useState(false);
  const rotate = useApiMutation(() => api.tasks.rotateDataCredential(id), { invalidate: [queryKeys.dataResources(projectId)], onSuccess: () => { setOpen(false); setDone(true); } });
  return <>
    <Button variant="danger" disabled={disabled} onClick={() => { rotate.reset(); setDone(false); setOpen(true); }}>{t('devSession.data.rotate')}</Button>
    {done ? <p role="status">{t('devSession.data.rotated')}</p> : null}
    {open ? <ConfirmDialog title={t('devSession.data.rotate')} question={t('devSession.data.rotateQuestion', { environment, id })} confirmWord="rotate" confirmLabel={t('devSession.data.rotate')} busy={rotate.isPending} onConfirm={() => rotate.mutate(undefined)} onCancel={() => setOpen(false)}>
      <p>{t('devSession.data.rotateNote')}</p>
      <QueryStatus isPending={false} error={rotate.error} />
    </ConfirmDialog> : null}
  </>;
}
