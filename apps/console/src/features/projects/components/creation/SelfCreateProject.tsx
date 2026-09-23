import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { CreateProjectRequestSchema, ProjectCreationCatalogSchema } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { FormField } from '../../../../shared/ui/FormField';
import { PageHeader } from '../../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import styles from '../CreateProjectForm.module.css';
import { ButtonLink } from '../../../../shared/ui/navigation/ButtonLink';

const empty = { name: '', slug: '', template: '' };
type Draft = typeof empty;
type Errors = Partial<Record<keyof Draft, string>>;

function readDraft(key: string): Draft {
  try { const value = JSON.parse(sessionStorage.getItem(key) ?? '{}'); return { name: typeof value.name === 'string' ? value.name : '', slug: typeof value.slug === 'string' ? value.slug : '', template: typeof value.template === 'string' ? value.template : '' }; } catch { return empty; }
}

export function SelfCreateProject() {
  const t = useT(), navigate = useNavigate();
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const catalog = useApiQuery(['project-creation'], async () => ProjectCreationCatalogSchema.parse(await api.catalog.projectCreation()));
  const key = `cs-project-draft:${me.data?.id ?? ''}`;
  return <><PageHeader title={t('projects.self.title')} description={t('projects.self.intro')} actions={<ButtonLink to="/projects">{t('projects.provision.backProjects')}</ButtonLink>} />
    <QueryStatus isPending={catalog.isPending} error={catalog.error} />
    {catalog.error ? <Button onClick={() => void catalog.refetch()}>{t('projects.wizard.refreshCatalog')}</Button> : null}
    {catalog.data ? <p>{t('projects.self.resources', { plan: catalog.data.defaultServicePlan, count: catalog.data.maxConcurrentTasks })}</p> : null}
    {catalog.data?.templates.length === 0 ? <ActionNote tone="neutral">{t('projects.wizard.noTemplates')}</ActionNote> : null}
    <SelfCreationFields key={key} storageKey={key} userId={me.data?.id} userName={me.data?.name} templates={catalog.data?.templates ?? []} available={!me.error && (me.data?.platformRole === 'developer' || me.data?.platformRole === 'admin') && !!catalog.data && !catalog.error && !catalog.isFetching}
      onCreated={(id) => void navigate({ to: '/projects/$projectId/provisioning', params: { projectId: id }, replace: true })} />
  </>;
}

interface FieldsProps { storageKey: string; userId: string | undefined; userName: string | undefined; templates: Array<{ id: string; name: string }>; available: boolean; onCreated(id: string): void }

function SelfCreationFields({ storageKey, userId, userName, templates, available, onCreated }: FieldsProps) {
  const t = useT(), form = useRef<HTMLFormElement>(null), busy = useRef(false);
  const [draft, setDraft] = useState(() => readDraft(storageKey)), [errors, setErrors] = useState<Errors>({}), [accepted, setAccepted] = useState<string>(), [unknown, setUnknown] = useState(false);
  const create = useApiMutation(() => api.projects.create({ ...draft, name: draft.name.trim(), kind: 'DigitalWorker' }), { invalidate: [queryKeys.projects(), queryKeys.me()] });
  useEffect(() => {
    if (accepted || !Object.values(draft).some(Boolean)) sessionStorage.removeItem(storageKey);
    else sessionStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft, storageKey, accepted]);
  useEffect(() => { form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }, [errors]);
  const delivered = useRef<string>(undefined);
  useEffect(() => { if (accepted && delivered.current !== accepted) { delivered.current = accepted; onCreated(accepted); } }, [accepted, onCreated]);
  const accept = (id: string) => { setAccepted(id); sessionStorage.removeItem(storageKey); };
  const reconcile = async () => {
    try { const result = await api.projects.page({ q: draft.slug, limit: 50 }); const found = result.items.find(({ project }) => project.slug === draft.slug && project.ownerUserId === userId); if (found) { accept(found.project.id); return; } setUnknown(false); }
    catch { setUnknown(true); }
  };
  const submit = async () => {
    if (busy.current || !available || unknown) return;
    const next: Errors = {}, parsed = CreateProjectRequestSchema.safeParse({ ...draft, name: draft.name.trim() });
    for (const issue of parsed.error?.issues ?? []) { const field = String(issue.path[0]) as keyof Draft; if (field in empty) next[field] = t(`projects.self.invalid.${field}`); }
    if (!templates.some((template) => template.id === draft.template)) next.template = t('projects.self.invalid.template');
    setErrors(next); if (Object.keys(next).length) return;
    busy.current = true;
    try { const result = await create.mutateAsync(); if (result.id && result.slug === draft.slug && result.ownerUserId === userId) accept(result.id); else setUnknown(true); }
    catch (error) {
      const failure = error as { status?: number; message?: string; details?: { field?: string; requestSent?: boolean } };
      if (failure.details?.field && failure.details.field in empty) setErrors({ [failure.details.field]: failure.message });
      if (failure.status === 0 && failure.details?.requestSent !== false) setUnknown(true);
    } finally { busy.current = false; }
  };
  return <><UnsavedChangesGuard dirty={!accepted && Object.values(draft).some(Boolean)} scope={t('projects.self.title')} />
    <Card compact title={t('projects.self.basics')}><p>{t('projects.self.owner', { name: userName ?? '' })}</p><p>{t('projects.self.defaults')}</p>
      <form ref={form} noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className={styles.form}>{(['name', 'slug', 'template'] as const).map((field) => <FormField key={field} label={t(`projects.create.${field}`)} hint={t(`projects.wizard.${field}Hint`)} error={errors[field]} hintId={`self-${field}-hint`} errorId={`self-${field}-error`}>
          {field === 'template' ? <select name={field} aria-invalid={!!errors[field]} aria-describedby={`self-${field}-hint self-${field}-error`} value={draft[field]} disabled={create.isPending || unknown} onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}>
            <option value="">{t('projects.wizard.chooseTemplate')}</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select> : <input name={field} value={draft[field]} aria-invalid={!!errors[field]} aria-describedby={`self-${field}-hint self-${field}-error`} disabled={create.isPending || unknown} onChange={(e) => setDraft({ ...draft, [field]: e.target.value })} />}
        </FormField>)}</div>
        {create.error ? <ActionNote tone="error">{create.error.message}</ActionNote> : null}
        {unknown ? <ActionNote tone="neutral">{t('projects.wizard.resultUnknown')} <Button onClick={() => void reconcile()}>{t('projects.self.reconcile')}</Button></ActionNote> : null}
        <Button type="submit" variant="primary" disabled={create.isPending || !available || unknown}>{t(create.isPending ? 'projects.create.submitting' : 'projects.create.submit')}</Button>
      </form>
    </Card></>;
}
