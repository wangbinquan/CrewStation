import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { FormField } from '../../../../shared/ui/FormField';
import type { CreationCatalog, CreationDraft, CreationErrors, CreationField, CreationScope } from '../../model/creationDraft';
import { creationKinds } from '../../model/creationDraft';
import styles from '../CreateProjectForm.module.css';

interface FieldsProps { draft: CreationDraft; errors: CreationErrors; catalog: CreationCatalog; scope: CreationScope; disabled: boolean; setField(field: CreationField, value: string): void }
const attributes = (field: CreationField, error?: string) => ({ name: field, 'aria-invalid': !!error, 'aria-describedby': `creation-${field}-hint${error ? ` creation-${field}-error` : ''}`, 'aria-errormessage': error ? `creation-${field}-error` : undefined });

export function CreationBasics({ draft, errors, catalog, scope, disabled, setField }: FieldsProps): ReactElement {
  const t = useT();
  return <div className={styles.form}>
    {(['name', 'slug'] as const).map((field) => <FormField key={field} label={t(`projects.create.${field}`)} hint={t(`projects.wizard.${field}Hint`)} hintId={`creation-${field}-hint`} error={errors[field]} errorId={`creation-${field}-error`}>
      <input {...attributes(field, errors[field])} value={draft[field]} disabled={disabled} onChange={(event) => setField(field, event.target.value)} />
    </FormField>)}
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
  </div>;
}

export function CreationResources({ draft, errors, catalog, disabled, setField }: FieldsProps): ReactElement {
  const t = useT(), options = catalog.templates.filter((template) => template.kind === draft.kind);
  return <div className={styles.form}>
    <FormField label={t('projects.create.template')} hint={t(options.length ? 'projects.wizard.templateHint' : 'projects.wizard.noTemplates')} hintId="creation-template-hint" error={errors.template} errorId="creation-template-error">
      <select {...attributes('template', errors.template)} value={draft.template} disabled={disabled} onChange={(event) => setField('template', event.target.value)}>
        <option value="">{t('projects.wizard.chooseTemplate')}</option>
        {options.map((template) => <option value={template.name} key={template.name}>{template.name}</option>)}
      </select>
    </FormField>
    <FormField label={t('projects.wizard.plan')} hint={t(catalog.plans.length ? 'projects.wizard.planHint' : 'projects.wizard.noPlans')} hintId="creation-plan-hint" error={errors.plan} errorId="creation-plan-error">
      <select {...attributes('plan', errors.plan)} value={draft.plan} disabled={disabled} onChange={(event) => setField('plan', event.target.value)}>
        <option value="">{t('projects.wizard.choosePlan')}</option>
        {catalog.plans.map((plan) => <option value={plan.name} key={plan.name}>{plan.name} · {plan.cpu} CPU · {plan.memory}</option>)}
      </select>
    </FormField>
    <FormField label={t('projects.wizard.quota')} hint={t('projects.wizard.quotaHint')} hintId="creation-maxConcurrentTasks-hint" error={errors.maxConcurrentTasks} errorId="creation-maxConcurrentTasks-error">
      <input {...attributes('maxConcurrentTasks', errors.maxConcurrentTasks)} inputMode="numeric" value={draft.maxConcurrentTasks} disabled={disabled} onChange={(event) => setField('maxConcurrentTasks', event.target.value)} />
    </FormField>
  </div>;
}
