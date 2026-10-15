import type { ObservationPrice, SaveObservationPrice } from '@crewstation/contracts';
import { useEffect, useState } from 'react';
import { api } from '../../../../shared/api/client';
import { errorMessage, useApiMutation } from '../../../../shared/api/useApi';
import { useDateText } from '../../../../shared/lib/useDateText';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { Button } from '../../../../shared/ui/Button';
import { Stack } from '../../../../shared/ui/Stack';
import { FormDialog } from '../../../../shared/ui/dialog/FormDialog';
import { initialTokenPriceDraft, priceBuckets, tokenPriceRequest } from '../../model/tokenPriceDraft';
import type { PriceLineTarget, TokenPriceDraft } from '../../model/tokenPriceDraft';
import { AdminField } from '../AdminField';

export interface TokenPriceEditorProps {
  target: PriceLineTarget; open: boolean; onDirtyChange: (dirty: boolean) => void;
  onClose: () => void; onClear: () => void; onSaved: () => void;
}

/** 追加一个价格版本；打开后这条线被别人改过时保存得到 409，草稿保留，核对最新版本后再保存。 */
export function TokenPriceEditor({ target, open, onDirtyChange, onClose, onClear, onSaved }: TokenPriceEditorProps) {
  const t = useT(), dateText = useDateText(), [initial] = useState(() => initialTokenPriceDraft(target.model ?? '', target.current, Date.now()));
  const [draft, setDraft] = useState(initial), [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [base, setBase] = useState<ObservationPrice | null>(target.current), [latest, setLatest] = useState<{ value: ObservationPrice | null }>();
  const [reloadError, setReloadError] = useState(false);
  const save = useApiMutation((input: SaveObservationPrice) => api.observability.savePrice(target.profile.profileId, input), { invalidate: [['admin', 'token-pricing']], onSuccess: onSaved });
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft);
  useEffect(() => { onDirtyChange(dirty || save.isPending); return () => onDirtyChange(false); }, [dirty, save.isPending, onDirtyChange]);
  const update = (key: keyof TokenPriceDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = () => {
    const result = tokenPriceRequest(draft, base?.id ?? null);
    setErrors(result.errors);
    if (result.input) save.mutate(result.input);
  };
  const compare = async () => {
    setReloadError(false); setLatest(undefined);
    try { setLatest({ value: (await api.observability.priceHistory(target.profile.profileId, draft.model.trim())).items[0] ?? null }); }
    catch { setReloadError(true); }
  };
  const useLatest = () => { if (!latest) return; setBase(latest.value); setLatest(undefined); save.reset(); };
  const field = (key: keyof TokenPriceDraft) => ({ value: draft[key], onChange: (value: string) => update(key, value), disabled: save.isPending, ...(errors[key] ? { error: t(errors[key]!) } : {}) });
  return <>
    <UnsavedChangesGuard dirty={dirty || save.isPending} scope={t('admin.pricing.title')} isNavigationBusy={() => save.isPending} />
    {open ? <FormDialog size="large" title={t('admin.pricing.editTitle', { name: target.profile.name })} submitLabel={t('admin.pricing.save')} busy={save.isPending}
      error={save.error ? errorMessage(save.error) : undefined} onSubmit={submit} onClose={onClose} onClear={onClear} dirty={dirty}>
      <Stack>
        <p>{t('admin.pricing.editHint')}</p>
        <p>{base ? t('admin.pricing.basedOn', { at: dateText(base.createdAt) }) : t('admin.pricing.firstVersion')}</p>
        {save.error?.kind === 'conflict' ? <Stack>
          <Button onClick={() => void compare()}>{t('admin.pricing.compare')}</Button>
          {reloadError ? <p role="alert">{t('admin.pricing.reloadFailed')}</p> : null}
          {latest ? <>
            <p>{latest.value ? t('admin.pricing.latest', { at: dateText(latest.value.createdAt), rates: priceBuckets.map((bucket) => latest.value!.rates[bucket] ?? '—').join(' / ') }) : t('admin.pricing.latestNone')}</p>
            <Button onClick={useLatest}>{t('admin.pricing.useLatest')}</Button>
          </> : null}
        </Stack> : null}
        <AdminField label={t('admin.pricing.model')} readOnly={target.model !== null} hint={t('admin.pricing.modelHint')} {...field('model')} />
        {priceBuckets.map((bucket) => <AdminField key={bucket} label={t('admin.pricing.' + bucket)} hint={t('admin.pricing.rateHint')} inputMode="decimal" {...field(bucket)} />)}
        <AdminField label={t('admin.pricing.effectiveFrom')} type="datetime-local" hint={t('admin.pricing.effectiveHint')} {...field('effectiveFrom')} />
        <AdminField label={t('admin.pricing.note')} rows={3} {...field('note')} />
      </Stack>
    </FormDialog> : null}
  </>;
}
