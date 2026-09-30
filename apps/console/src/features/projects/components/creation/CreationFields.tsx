import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { FormField } from '../../../../shared/ui/FormField';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import type { CreationCatalog, CreationDraft, CreationErrors, CreationField, CreationScope } from '../../model/creationDraft';
import { creationKinds } from '../../model/creationDraft';
import { templateDescription } from '../../model/templateDescriptions';
import { CreationDomainPreview } from './CreationDomainPreview';
import styles from '../CreateProjectForm.module.css';

export interface CreationFieldsProps { draft: CreationDraft; errors: CreationErrors; catalog: CreationCatalog; scope: CreationScope; disabled: boolean; self: boolean; defaultTasks?: number; setField(field: CreationField, value: string): void }
const attributes = (field: CreationField, error?: string) => ({ name: field, 'aria-invalid': !!error, 'aria-describedby': `creation-${field}-hint${error ? ` creation-${field}-error` : ''}`, 'aria-errormessage': error ? `creation-${field}-error` : undefined });

export function CreationBasics({ draft, errors, catalog, scope, disabled, self, setField }: CreationFieldsProps): ReactElement {
  const t = useT();
  return <section className={styles.section}>
    <div className={styles.heading}><h3>{t('projects.creation.identity')}</h3><span>{t('projects.creation.identityHint')}</span></div>
    <div className={styles.identityGrid}><div className={styles.identityFields}><div className={styles.form}>
      {(['name', 'slug'] as const).map((field) => <FormField key={field} label={t(`projects.create.${field}`)} hint={t(`projects.wizard.${field}Hint`)} hintId={`creation-${field}-hint`} error={errors[field]} errorId={`creation-${field}-error`}>
        <input {...attributes(field, errors[field])} value={draft[field]} disabled={disabled} placeholder={t(`projects.creation.${field}Placeholder`)} maxLength={field === 'name' ? 80 : 40}
          autoCapitalize={field === 'slug' ? 'none' : undefined} spellCheck={field !== 'slug'} onChange={(event) => setField(field, event.target.value)} />
      </FormField>)}
    </div>
    <p className={styles.format}>{t('projects.creation.slugFormat')}</p></div>
    <CreationDomainPreview slug={draft.slug} kind={draft.kind} />
    {self ? <p className={styles.owner}>{t('projects.self.owner', { name: catalog.users[0]?.name ?? '' })}<span>{t('projects.creation.ownerEffect')}</span></p> : <div className={[styles.ownerFields, scope === 'integration' ? styles.form : ''].join(' ')}>
      <FormField label={t('projects.create.owner')} hint={t('projects.wizard.ownerHint')} hintId="creation-ownerUserId-hint" error={errors.ownerUserId} errorId="creation-ownerUserId-error">
        <select {...attributes('ownerUserId', errors.ownerUserId)} value={draft.ownerUserId} disabled={disabled} onChange={(event) => setField('ownerUserId', event.target.value)}>
          <option value="">{t('projects.create.ownerPlaceholder')}</option>
          {catalog.users.map((user) => <option value={user.id} key={user.id}>{user.name}（{user.email}）</option>)}
        </select>
      </FormField>
      {scope === 'integration' ? <FormField label={t('projects.create.kind')} hint={t('projects.wizard.kindHint')} hintId="creation-kind-hint" error={errors.kind} errorId="creation-kind-error">
        <select {...attributes('kind', errors.kind)} value={draft.kind} disabled={disabled} onChange={(event) => setField('kind', event.target.value)}>
          {creationKinds(scope).map((kind) => <option key={kind} value={kind}>{t(`projects.kind.${kind}`)}</option>)}
        </select>
      </FormField> : null}
    </div>}</div>
  </section>;
}

export function CreationResources(props: CreationFieldsProps): ReactElement {
  const { draft, errors, catalog, disabled, setField } = props, t = useT();
  const options = catalog.templates.filter((template) => template.kind === draft.kind), template = options.find((item) => item.id === draft.template);
  const description = template && templateDescription(template, t);
  return <>
    <section className={[styles.section, styles.templates].join(' ')}>
      <div className={styles.heading}><h3>{t('projects.creation.code')}</h3><span>{t('projects.creation.codeHint')}</span></div>
      <div className={styles.templateGrid}>
        <FormField label={t('projects.create.template')} hint={t(options.length ? 'projects.wizard.templateHint' : 'projects.wizard.noTemplates')} hintId="creation-template-hint" error={errors.template} errorId="creation-template-error">
          <select {...attributes('template', errors.template)} value={draft.template} disabled={disabled} onChange={(event) => setField('template', event.target.value)}>
            <option value="">{t('projects.wizard.chooseTemplate')}</option>
            {options.map((item) => <option value={item.id} key={item.id}>{templateDescription(item, t).name}</option>)}
          </select>
        </FormField>
        {description ? <div className={styles.templateDetail}><strong>{description.name}</strong><p>{description.description}</p>{description.contents ? <small>{description.contents}</small> : null}</div> : null}
      </div>
      {template?.requiredConfig.length ? <ActionNote tone="neutral">{t('projects.wizard.requiredConfig', { keys: template.requiredConfig.map((item) => `${item.name}（${t(`projects.wizard.config.${item.from}`)}）`).join('、') })}</ActionNote> : null}
    </section>
    <CreationResourceSettings {...props} />
  </>;
}

function CreationResourceSettings({ draft, errors, catalog, disabled, self, defaultTasks, setField }: CreationFieldsProps) {
  const t = useT(), plan = catalog.plans.find((item) => item.id === draft.plan);
  return <details className={styles.resources} open={!!errors.plan || !!errors.maxConcurrentTasks}>
    <summary><span>{t('projects.creation.resources')} <small>{t(self ? 'projects.wizard.platformDefault' : 'projects.creation.optional')}</small></span>
      <span>{t('projects.creation.resourceSummary', { plan: self ? t('projects.wizard.platformDefault') : plan?.name ?? t('projects.wizard.platformDefault'), count: draft.maxConcurrentTasks || defaultTasks || '—' })}</span></summary>
    <div className={styles.resourceFields}>{self ? <p>{t('projects.self.defaults')}</p> : <div className={styles.form}>
      <FormField label={t('projects.wizard.plan')} hint={t(catalog.plans.length ? 'projects.wizard.planHint' : 'projects.wizard.noPlans')} hintId="creation-plan-hint" error={errors.plan} errorId="creation-plan-error">
        <select {...attributes('plan', errors.plan)} value={draft.plan} disabled={disabled} onChange={(event) => setField('plan', event.target.value)}>
          <option value="">{t('projects.wizard.choosePlan')}</option>{catalog.plans.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.cpu} CPU · {item.memory}</option>)}
        </select>
      </FormField>
      <FormField label={t('projects.wizard.quota')} hint={t('projects.wizard.quotaHint')} hintId="creation-maxConcurrentTasks-hint" error={errors.maxConcurrentTasks} errorId="creation-maxConcurrentTasks-error">
        <input {...attributes('maxConcurrentTasks', errors.maxConcurrentTasks)} inputMode="numeric" value={draft.maxConcurrentTasks} placeholder={String(defaultTasks ?? '')} disabled={disabled} onChange={(event) => setField('maxConcurrentTasks', event.target.value)} />
      </FormField>
    </div>}</div>
  </details>;
}
