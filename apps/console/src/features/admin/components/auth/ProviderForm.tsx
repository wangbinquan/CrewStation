import type { CreateOidcProviderRequest, OidcProviderDto } from '@crewstation/contracts';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { Button } from '../../../../shared/ui/Button';
import { ConfirmationPanel } from '../../../../shared/ui/ConfirmationPanel';
import { Tabs } from '../../../../shared/ui/Tabs';
import { AdminForm } from '../AdminForm';
import { useProviderDraft } from '../../hooks/useProviderDraft';
import { providerFieldGroup, providerGroups } from '../../model/providerDraft';
import type { ProviderGroup } from '../../model/providerDraft';
import { ProviderFields } from './provider/ProviderFields';

export interface ProviderFormProps {
  readonly initial?: OidcProviderDto;
  readonly busy: boolean;
  readonly onCancel?: () => void;
  readonly error?: ReactNode;
  readonly onSubmit: (body: CreateOidcProviderRequest) => void;
}

export function ProviderForm({ initial, busy, error, onSubmit, onCancel }: ProviderFormProps) {
  const t = useT(), draft = useProviderDraft(initial), root = useRef<HTMLDivElement>(null);
  const [discard, setDiscard] = useState(false);
  useEffect(() => { root.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus(); }, []);
  useEffect(() => { if (draft.attempt) root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }, [draft.attempt]);
  return <div ref={root}>
    <UnsavedChangesGuard dirty={draft.dirty || busy} scope={initial?.displayName ?? t('admin.auth.providerNew')} isNavigationBusy={() => busy} />
    <AdminForm stacked submitLabel={t(initial ? 'admin.auth.providerSave' : 'admin.auth.providerAdd')} busyLabel={t('admin.auth.saving')} busy={busy} incomplete={false}
      extraActions={onCancel ? <Button variant="ghost" disabled={busy} onClick={() => draft.dirty ? setDiscard(true) : onCancel()}>{t('admin.auth.cancelEdit')}</Button> : undefined}
      error={error} note={t('admin.auth.providerNote')} onSubmit={() => { if (busy || discard) return; const body = draft.validate(); if (body) onSubmit(body); }}>
      <Tabs label={t('admin.identity.providerGroups')} value={draft.group} onChange={(group) => draft.setGroup(group as ProviderGroup)} items={providerGroups.map((group) => {
        const count = Object.keys(draft.errors).filter((key) => providerFieldGroup(key) === group).length;
        return { value: group, label: `${t(`admin.identity.group.${group}`)}${count ? ` · ${t(count === 1 ? 'admin.identity.error' : 'admin.identity.errors', { count })}` : ''}` };
      })}><fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><ProviderFields draft={draft} editing={Boolean(initial)} secretSet={initial?.clientSecretSet ?? false} /></fieldset></Tabs>
    </AdminForm>
    {discard ? <ConfirmationPanel question={t('ui.draft.question', { scope: initial?.displayName ?? t('admin.auth.providerNew') })} hint={t('ui.draft.hint')} confirmLabel={t('ui.draft.leave')} cancelLabel={t('ui.draft.stay')} onConfirm={() => onCancel?.()} onCancel={() => setDiscard(false)} /> : null}
  </div>;
}
