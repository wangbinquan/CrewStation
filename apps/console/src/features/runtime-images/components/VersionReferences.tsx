import type { RuntimeImageVersionDto } from '@crewstation/contracts';
import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { ConfirmDialog } from '../../../shared/ui/dialog/ConfirmDialog';
import styles from './RuntimeImages.module.css';

export function VersionReferences({ projectId, imageId, version, manageable }: {
  readonly projectId: string; readonly imageId: string; readonly version: RuntimeImageVersionDto; readonly manageable: boolean;
}) {
  const t = useT(), [confirming, setConfirming] = useState(false);
  const references = useApiQuery(['runtime-images', projectId, imageId, 'references', version.id], () => api.runtimeImages.references(projectId, imageId, version.id), AUTO_REFRESH);
  const retire = useApiMutation(() => api.runtimeImages.retire(projectId, imageId, version.id), { invalidate: [['runtime-images', projectId, imageId]], onSuccess: () => setConfirming(false) });
  return <div className={styles.stack}>
    <h4>{t('images.references')}</h4><QueryStatus isPending={references.isPending} error={references.error} />
    {references.data ? <p>{t('images.referenceCount', { count: references.data.total })}</p> : null}
    {references.data?.items.map((ref) => <p className={styles.identity} key={ref.id}>{t(`images.owner.${ref.ownerType}`)} · {ref.ownerId} · {t(`images.reference.${ref.state}`)}</p>)}
    {references.data && references.data.total > references.data.items.length ? <p>{t('images.hiddenReferences')}</p> : null}
    {manageable && version.state === 'disabled' ? <Button variant="danger" onClick={() => setConfirming(true)} disabled={!references.data || !!references.error || references.data.total > 0}>{t('images.retire')}</Button> : null}
    {retire.isSuccess ? <ActionNote tone="success">{t('images.retiredNote')}</ActionNote> : null}
    {confirming ? <ConfirmDialog title={t('images.retire')} question={t('images.retireQuestion', { version: version.id })} confirmWord="delete" confirmLabel={t('images.retire')} busy={retire.isPending} confirmDisabled={!references.data || !!references.error || references.data.total > 0} onConfirm={() => retire.mutate()} onCancel={() => setConfirming(false)}>
      <p>{t('images.retiredNote')}</p>{retire.error ? <ActionNote tone="error">{errorMessage(retire.error)}</ActionNote> : null}
    </ConfirmDialog> : null}
  </div>;
}
