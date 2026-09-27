import { FormField } from '../../../shared/ui/FormField';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { revisionDraft } from '../model/imageDraft';
import styles from './RuntimeImages.module.css';

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined; }
function recipe(value: string): ObjectValue | undefined { try { return object(JSON.parse(value)); } catch { return undefined; } }

/** 常用来源字段直接编辑；高级 JSON 保留完整配方与暂时无效的草稿，不静默丢弃未知字段。 */
export function RecipeEditor({ projectId, value, onChange }: { readonly projectId: string; readonly value: string; readonly onChange: (value: string) => void }) {
  const t = useT(), parsed = recipe(value), source = object(parsed?.source), profile = object(source?.baseProfile);
  const project = useApiQuery(['runtime-images', projectId, 'source-project'], () => api.projects.get(projectId), { ...AUTO_REFRESH, enabled: source?.kind === 'source' });
  const update = (change: ObjectValue) => onChange(JSON.stringify({ ...parsed, source: { ...source, ...change } }, null, 2));
  const field = (key: string, label: string, placeholder?: string) => <FormField label={t(label)}><input value={typeof source?.[key] === 'string' ? source[key] : ''} placeholder={placeholder} onChange={(event) => update({ [key]: event.target.value })} /></FormField>;
  return <div className={styles.stack}>
    {source ? <>
      <FormField label={t('images.sourceKind')}><select value={String(source.kind ?? 'source')} onChange={(event) => {
        const next = event.target.value === 'existing' ? { kind: 'existing', reference: '', usage: source.usage, architecture: source.architecture } : { ...object(recipe(revisionDraft())?.source), usage: source.usage, architecture: source.architecture };
        onChange(JSON.stringify({ ...parsed, source: next }, null, 2));
      }}><option value="source">{t('images.sourceBuild')}</option><option value="existing">{t('images.sourceExisting')}</option></select></FormField>
      <div className={styles.row}>
        <FormField label={t('images.purpose')}><select value={String(source.usage ?? 'task')} onChange={(event) => update({ usage: event.target.value, ...(event.target.value !== 'agent' ? { baseProfile: undefined } : {}) })}>
          {(['task', 'agent', 'service'] as const).map((usage) => <option key={usage} value={usage}>{t(`images.usage.${usage}`)}</option>)}
        </select></FormField>
        <FormField label={t('images.architecture')}><select value={String(source.architecture ?? 'linux/amd64')} onChange={(event) => update({ architecture: event.target.value })}><option>linux/amd64</option><option>linux/arm64</option></select></FormField>
      </div>
      {source.kind === 'source' ? <>
        <FormField label={t('images.repositoryBinding')}><select value={String(source.repositoryBindingId ?? '')} disabled={project.isPending || !!project.error} onChange={(event) => update({ repositoryBindingId: event.target.value })}>
          <option value="">{t('images.chooseRepository')}</option>
          {project.data?.serviceId ? <option value={project.data.serviceId}>{project.data.name}</option> : null}
          {source.repositoryBindingId && source.repositoryBindingId !== project.data?.serviceId ? <option value={String(source.repositoryBindingId)}>{String(source.repositoryBindingId)}</option> : null}
        </select></FormField><QueryStatus isPending={project.isPending} error={project.error} />
        {field('ref', 'images.gitRef', 'main')}
        {field('context', 'images.context', '.')}{field('dockerfile', 'images.dockerfile', 'Dockerfile')}
        {source.usage === 'agent' ? <div className={styles.row}>
          <FormField label={t('images.baseProfile')}><input value={String(profile?.profileId ?? '')} onChange={(event) => update({ baseProfile: { revision: 1, ...profile, profileId: event.target.value } })} /></FormField>
          <FormField label={t('images.profileRevision')}><input type="number" min={1} value={Number(profile?.revision ?? 1)} onChange={(event) => update({ baseProfile: { ...profile, revision: Number(event.target.value) } })} /></FormField>
        </div> : null}
      </> : field('reference', 'images.existingReference', 'runtime/tools:1.0')}
    </> : null}
    <details open={!source}><summary>{t('images.advancedRecipe')}</summary>
      <p>{t('images.recipeHint')}</p><FormField label={t('images.recipe')}><textarea rows={20} spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} /></FormField>
    </details>
  </div>;
}
