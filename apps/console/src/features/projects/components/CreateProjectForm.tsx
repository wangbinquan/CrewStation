import type { ProjectDto } from '@crewstation/contracts';
import { useEffect, useRef } from 'react';
import { useT } from '../../../shared/lib/useT';
import { errorMessage } from '../../../shared/api/useApi';
import { UnsavedChangesGuard } from '../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { useProjectCreation } from '../hooks/useProjectCreation';
import type { CreationScope } from '../model/creationDraft';
import { CreationBasics, CreationResources } from './creation/CreationFields';
import { CreationReview } from './creation/CreationReview';
import styles from './CreateProjectForm.module.css';

/** 三步只收集创建输入；开通事实由创建后的状态页读取。 */
export function CreateProjectForm({ scope, onCreated }: { scope: CreationScope; onCreated(project: ProjectDto): void }) {
  const t = useT(), form = useRef<HTMLFormElement>(null);
  const state = useProjectCreation(scope, onCreated);
  const { draft, step, errors, catalog, create, users, templates, plans } = state;
  useEffect(() => { form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }, [errors, step]);
  const fields = { draft, errors, catalog, scope, disabled: create.isPending, setField: state.setField };
  return <>
    <UnsavedChangesGuard dirty={state.dirty} scope={t(`projects.wizard.title.${scope}`)} />
    <Card compact title={t(`projects.wizard.step${step + 1}`)} extra={<Button disabled={create.isPending || users.isFetching || templates.isFetching || plans.isFetching} onClick={() => { void Promise.all([users.refetch(), templates.refetch(), plans.refetch()]); }}>{t('projects.wizard.refreshCatalog')}</Button>}>
    <ol className={styles.steps} aria-label={t('projects.wizard.steps')}>
      {[0, 1, 2].map((item) => <li key={item} aria-current={step === item ? 'step' : undefined}><Badge tone={step === item ? 'info' : 'neutral'}>{item + 1} · {t(`projects.wizard.step${item + 1}`)}</Badge></li>)}
    </ol>
    <QueryStatus isPending={users.isPending} error={users.error} loadingKey="projects.create.usersLoading" errorKey="projects.create.usersError" />
    <QueryStatus isPending={templates.isPending || plans.isPending} error={templates.error ?? plans.error} loadingKey="projects.wizard.catalogLoading" errorKey="projects.wizard.catalogError" />
    <form ref={form} noValidate onSubmit={(event) => { event.preventDefault(); if (step === 2) void state.submit(); else state.next(); }}>
      {step === 0 ? <CreationBasics {...fields} /> : step === 1 ? <CreationResources {...fields} /> : <CreationReview draft={draft} catalog={catalog} />}
      {create.isError ? <ActionNote tone="error">{t('projects.create.error', { message: errorMessage(create.error) })}</ActionNote> : null}
      {state.resultError ? <ActionNote tone="error">{state.resultError}</ActionNote> : null}
      {create.isPending ? <ActionNote tone="neutral">{t('projects.wizard.pendingNote')}</ActionNote> : null}
      <div className={styles.submit}>
        {step > 0 ? <Button disabled={create.isPending} onClick={state.back}>{t('projects.wizard.back')}</Button> : null}
        <Button type="submit" variant="primary" disabled={create.isPending || !state.available}>{t(create.isPending ? 'projects.create.submitting' : step === 2 ? 'projects.create.submit' : 'projects.wizard.next')}</Button>
      </div>
    </form>
  </Card></>;
}
