import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { FormField } from '../../../shared/ui/FormField';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import type { RuntimeImageUsage } from '@crewstation/contracts';
import { validationDraft } from '../model/imageDraft';
import styles from './RuntimeImages.module.css';

function target(value: string): Record<string, unknown> | undefined {
  try { const parsed: unknown = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined; } catch { return undefined; }
}

/** 表单只修改当前字段；高级 JSON 中的 probes 与暂时无效草稿不被静默丢弃。 */
export function ValidationEditor({ projectId, value, onChange }: { readonly projectId: string; readonly value: string; readonly onChange: (value: string) => void }) {
  const t = useT(), parsed = target(value), profile = parsed?.profile && typeof parsed.profile === 'object' ? parsed.profile as Record<string, unknown> : {};
  const profiles = useApiQuery(['runtime-images', projectId, 'validation-profiles'], () => api.catalog.listComputeProfiles(projectId), { ...AUTO_REFRESH, enabled: parsed?.usage === 'agent' });
  const update = (fields: Record<string, unknown>) => onChange(JSON.stringify({ ...parsed, ...fields }, null, 2));
  return <div className={styles.stack}>
    {parsed ? <>
      <FormField label={t('images.purpose')}><select value={String(parsed.usage ?? 'task')} onChange={(event) => onChange(validationDraft(event.target.value as RuntimeImageUsage))}>
        {(['task', 'agent', 'service'] as const).map((usage) => <option key={usage} value={usage}>{t(`images.usage.${usage}`)}</option>)}
      </select></FormField>
      {parsed.usage === 'agent' ? <>
        <FormField label={t('images.agentProfile')}><select value={String(profile.profileId ?? '')} onChange={(event) => { const selected = profiles.data?.items.find((item) => item.id === event.target.value); update({ profile: { profileId: event.target.value, revision: selected?.revision } }); }}>
          <option value="">{t('images.selectProfile')}</option>
          {profiles.data?.items.map((item) => <option key={item.id} value={item.id} disabled={!item.available}>{item.name}</option>)}
          {profile.profileId && !profiles.data?.items.some((item) => item.id === profile.profileId) ? <option value={String(profile.profileId)}>{String(profile.profileId)}</option> : null}
        </select></FormField>
        <QueryStatus isPending={profiles.isPending} error={profiles.error} />
        {profile.profileId ? <p>{t('images.profileVersion', { revision: typeof profile.revision === 'number' ? profile.revision : '?' })}</p> : null}
      </> : null}
      {parsed.usage === 'service' ? <>
        <p>{t('images.serviceValidationHint')}</p>
        <FormField label={t('images.serviceCommand')}><textarea rows={4} value={Array.isArray(parsed.command) ? parsed.command.join('\n') : ''} onChange={(event) => update({ command: event.target.value.split('\n') })} /></FormField>
        <FormField label={t('images.servicePort')}><input type="number" min={1} max={65535} value={typeof parsed.port === 'number' ? parsed.port : ''} onChange={(event) => update({ port: Number(event.target.value) })} /></FormField>
        <FormField label={t('images.serviceHealth')}><input value={typeof parsed.healthPath === 'string' ? parsed.healthPath : ''} onChange={(event) => update({ healthPath: event.target.value })} /></FormField>
      </> : null}
    </> : null}
    <details open={!parsed}><summary>{t('images.advancedValidation')}</summary>
      <FormField label={t('images.validationTarget')}><textarea rows={10} spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} /></FormField>
    </details>
  </div>;
}
