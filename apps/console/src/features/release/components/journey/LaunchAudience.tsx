import { useState } from 'react';
import type { AppVisibilityDto } from '@crewstation/contracts';
import type { LaunchAudience as AudienceHandle } from '../../model/journey/useLaunchAudience';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { Dialog } from '../../../../shared/ui/dialog/Dialog';

export function LaunchAudience({ audience, disabled, readOnly = false }: { readonly audience: AudienceHandle; readonly disabled: boolean; readonly readOnly?: boolean }) {
  const t = useT(), [preview, setPreview] = useState(false), policy = readOnly ? audience.query.data : audience.current;
  if (!audience.enabled) return null;
  return <section aria-label={t('release.audience.title')}>
    <h3>{t(readOnly ? 'release.audience.applied' : 'release.audience.title')}</h3>
    <QueryStatus isPending={audience.query.isPending} error={audience.query.error} />
    {policy && !audience.query.error ? <>
      {readOnly ? <p><strong>{t(`release.audience.mode.${policy.mode}`)}</strong> · {t('release.audience.revision', { revision: policy.revision })}</p>
        : <fieldset disabled={disabled || audience.busy || !policy.canConfigure}><legend>{t('release.audience.choose')}</legend>
          {(['members', 'authenticated'] as const).map(mode => <label key={mode}><input type="radio" name="launch-audience" value={mode} checked={policy.mode === mode} onChange={() => audience.select(mode)} />{t(`release.audience.mode.${mode}`)} </label>)}</fieldset>}
      <p>{t('release.audience.hint')}</p>
      {!readOnly && !policy.canConfigure ? <p>{t('release.audience.noPermission')}</p> : null}
      <Button onClick={() => setPreview(true)}>{t('release.audience.preview')}</Button>
      {preview ? <AccessPreview policy={policy} onClose={() => setPreview(false)} /> : null}
    </> : null}
    {audience.conflict ? <ActionNote tone="neutral">{t('release.audience.changed')} <Button disabled={audience.busy} onClick={audience.recheck}>{t('release.wizard.recheck')}</Button></ActionNote> : null}
    {audience.saved ? <ActionNote tone="neutral">{t('release.audience.saved')}</ActionNote> : null}
    {audience.error ? <ActionNote tone="error">{audience.error}</ActionNote> : null}
  </section>;
}

function AccessPreview({ policy, onClose }: { readonly policy: AppVisibilityDto; readonly onClose: () => void }) {
  const t = useT(), [identity, setIdentity] = useState('member');
  const result = identity === 'guest' ? 'signIn' : identity === 'member' || policy.mode === 'authenticated' ? 'allowed' : policy.allowRequests ? 'request' : 'contact';
  return <Dialog title={t('release.audience.preview')} onClose={onClose}>
    <p>{t('release.audience.previewHint')}</p>
    <label>{t('release.audience.identity')} <select value={identity} onChange={event => setIdentity(event.target.value)}>
      {['member', 'other', 'guest'].map(value => <option key={value} value={value}>{t(`release.audience.identity.${value}`)}</option>)}
    </select></label>
    <ActionNote tone="neutral">{t(`release.audience.result.${result}`)}</ActionNote>
  </Dialog>;
}
