import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import type { ProfileDraft } from '../../model/profileDraft';
import type { DraftErrors } from '../../model/stepDraft';
import { AdminField } from '../AdminField';
import styles from './ComputeEditor.module.css';

/** The administrator edits non-secret native settings; credentials remain in the existing Secret editor. */
export function ProfileModelMaterialEditor({ draft, errors, disabled, onChange }: { readonly draft: ProfileDraft; readonly errors: DraftErrors; readonly disabled: boolean; readonly onChange: (fn: (draft: ProfileDraft) => ProfileDraft) => void }): ReactElement | null {
  const t = useT();
  if (draft.protocol !== 'opencode') return null;
  return <div className={styles.sub}>
    <h3>{t('admin.profile.provider.title')}</h3>
    <p className={styles.hint}>{t('admin.profile.provider.hint')}</p>
    <AdminField label={t('admin.profile.provider.material')} value={draft.opencodeProvider} rows={12} monospace disabled={disabled}
      placeholder={'{\n  "id": "gateway",\n  "npm": "@ai-sdk/openai-compatible",\n  "models": { "my-model": { "name": "My model" } },\n  "options": { "baseURL": "https://gateway.example/v1" },\n  "credentials": { "apiKey": "MODEL_API_KEY" }\n}'}
      error={errors.opencodeProvider ? t('admin.profile.error.opencodeProvider') : undefined}
      onChange={(opencodeProvider) => onChange((current) => ({ ...current, opencodeProvider }))} />
    <p className={styles.hint}>{t('admin.profile.provider.secrets', { names: draft.secrets.map((secret) => secret.name).join(', ') || '—' })}</p>
  </div>;
}
