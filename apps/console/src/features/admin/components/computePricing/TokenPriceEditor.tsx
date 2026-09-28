import type { SaveTokenPrice, TokenPriceProfile } from '@crewstation/contracts';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../shared/api/client';
import { errorMessage, useApiMutation } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { FormDialog } from '../../../../shared/ui/dialog/FormDialog';
import { Stack } from '../../../../shared/ui/Stack';
import { Button } from '../../../../shared/ui/Button';
import { AdminField } from '../AdminField';
import { initialTokenPriceDraft, priceBuckets, tokenPriceRequest } from '../../model/tokenPriceDraft';
import type { TokenPriceDraft } from '../../model/tokenPriceDraft';

export interface TokenPriceEditorProps {
  profile: TokenPriceProfile; open: boolean; onDirtyChange: (dirty: boolean) => void;
  onClose: () => void; onClear: () => void; onSaved: () => void;
}
export function TokenPriceEditor({ profile, open, onDirtyChange, onClose, onClear, onSaved }: TokenPriceEditorProps) {
  const t = useT(), [initial] = useState(() => initialTokenPriceDraft(profile, Date.now()));
  const [draft, setDraft] = useState(initial), [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [currentProfile, setCurrentProfile] = useState(profile);
  const [revision, setRevision] = useState(profile.pricingRevision);
  const [latest, setLatest] = useState<TokenPriceProfile>();
  const [reloadError, setReloadError] = useState(false);
  const receipt = useRef<{ signature: string; input: SaveTokenPrice }>(undefined);
  const save = useApiMutation((input: SaveTokenPrice) => api.observability.savePrice(profile.id, input), { invalidate: [['admin', 'token-pricing']], onSuccess: onSaved });
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft);
  useEffect(() => { onDirtyChange(dirty || save.isPending); return () => onDirtyChange(false); }, [dirty, save.isPending, onDirtyChange]);
  const update = (key: keyof TokenPriceDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = async () => {
    const signature = JSON.stringify({ draft, revision, profileRevision: currentProfile.revision, protocol: currentProfile.protocol });
    if (receipt.current?.signature !== signature) {
      const result = tokenPriceRequest(draft, currentProfile, revision, crypto.randomUUID(), Date.now());
      setErrors(result.errors);
      if (!result.input) return;
      receipt.current = { signature, input: result.input };
    }
    // Retry the exact submitted request even after activation; the server replays its receipt.
    try { await save.mutateAsync(receipt.current.input); }
    catch { /* The mutation keeps the response error and the draft visible. */ }
  };
  const canReload = save.error?.kind === 'conflict' && (typeof save.error.details['revision'] === 'number' || save.error.details['code'] === 'profile_revision_conflict');
  const rebase = async () => {
    setReloadError(false); setLatest(undefined);
    try {
      const [directory, history] = await Promise.all([api.observability.pricingProfiles(), api.observability.priceHistory(profile.id, { limit: 1 })]);
      const refreshed = directory.items.find((row) => row.id === profile.id);
      if (refreshed) setLatest({ ...refreshed, pricingRevision: history.revision });
      else setReloadError(true);
    } catch { setReloadError(true); }
  };
  const useLatest = () => {
    if (!latest) return;
    setCurrentProfile(latest); setRevision(latest.pricingRevision); setLatest(undefined);
    receipt.current = undefined; setErrors({}); save.reset();
  };
  return <>
    <UnsavedChangesGuard dirty={dirty || save.isPending} scope={t('admin.pricing.title')} isNavigationBusy={() => save.isPending} />
    {open ? <FormDialog size="large" title={t('admin.pricing.editTitle', { name: profile.name })} submitLabel={t('admin.pricing.save')} busy={save.isPending} error={save.error ? errorMessage(save.error) : undefined} onSubmit={() => void submit()} onClose={onClose} onClear={onClear} dirty={dirty}>
      <Stack>
        <p>{t('admin.pricing.hint')}</p>
        <p>{t('admin.pricing.versionHint', { revision, profileRevision: currentProfile.revision })}</p>
        {canReload ? <Stack>
          <Button onClick={() => void rebase()}>{t('admin.pricing.compare')}</Button>
          {reloadError ? <p role="alert">{t('admin.pricing.reloadFailed')}</p> : null}
          {latest ? <>
            <p>{t('admin.pricing.latest', { revision: latest.pricingRevision })}</p>
            <p>{t('admin.pricing.profileLatest', { revision: latest.revision, protocol: latest.protocol, model: latest.model ?? '—' })}</p>
            {latest.protocol === 'terminal' ? <p>{t('admin.pricing.unsupported')}</p> : <Button onClick={useLatest}>{t('admin.pricing.useLatest')}</Button>}
          </> : null}
        </Stack> : null}
        {(['provider', 'model', 'condition', 'effectiveFrom', ...priceBuckets, 'sourceNote'] as const).map((key) =>
          <AdminField key={key} label={t('admin.pricing.' + key)} value={draft[key]} onChange={(value) => update(key, value)}
            disabled={save.isPending} type={key === 'effectiveFrom' ? 'datetime-local' : 'text'}
            {...(priceBuckets.includes(key as typeof priceBuckets[number]) ? { hint: t('admin.pricing.rateHint'), inputMode: 'decimal' as const } : {})}
            {...(errors[key] ? { error: t(errors[key]!) } : {})} {...(key === 'sourceNote' ? { rows: 3 } : {})} />)}
      </Stack>
    </FormDialog> : null}
  </>;
}
