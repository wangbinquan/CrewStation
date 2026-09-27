import { ActionRow } from '../../../shared/ui/ActionRow';
import type { RuntimeImageDto } from '@crewstation/contracts';
import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { ImageActionConfirmation } from './ImageActionConfirmation';

export function ImageVisibility({ image }: { readonly image: RuntimeImageDto }) {
  const t = useT(), [pending, setPending] = useState<RuntimeImageDto>();
  const change = useApiMutation(() => api.runtimeImages.update(undefined, pending!.id, { defaultVisible: !pending!.defaultVisible, expectedRevision: pending!.revision }), { invalidate: [['runtime-images']], onSuccess: () => setPending(undefined) });
  return <><p>{t('images.defaultVisibility')}：{t(image.defaultVisible ? 'images.defaultVisible' : 'images.defaultHidden')}</p>
    <p>{t('images.defaultVisibilityHint')}</p>
    <ActionRow><Button onClick={() => { change.reset(); setPending({ ...image }); }}>{t(image.defaultVisible ? 'images.defaultHiddenAction' : 'images.defaultVisibleAction')}</Button></ActionRow>
    {pending ? <ImageActionConfirmation title={t(pending.defaultVisible ? 'images.defaultHiddenAction' : 'images.defaultVisibleAction')} target={<strong>{pending.name}</strong>} hint={t(pending.defaultVisible ? 'images.confirmHide' : 'images.confirmShare')} busy={change.isPending} error={change.error} onConfirm={() => change.mutate()} onCancel={() => setPending(undefined)} /> : null}
  </>;
}
