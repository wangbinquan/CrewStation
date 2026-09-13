import type { ProjectDto } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import type { CreationCatalog, CreationErrors, CreationField, CreationScope } from '../model/creationDraft';
import { BASIC_FIELDS, creationErrors, creationInput, creationServerErrors, initialCreationDraft } from '../model/creationDraft';

export function useProjectCreation(scope: CreationScope, onCreated: (project: ProjectDto) => void) {
  const t = useT(), busy = useRef(false);
  const [draft, setDraft] = useState(() => initialCreationDraft(scope)), [step, setStep] = useState(0), [errors, setErrors] = useState<CreationErrors>({});
  const users = useApiQuery(queryKeys.users(), () => api.users.list());
  const templates = useApiQuery(queryKeys.projectTemplates(), () => api.catalog.listProjectTemplates());
  const plans = useApiQuery(queryKeys.servicePlans(), () => api.catalog.listServicePlans());
  const catalog: CreationCatalog = { users: users.data?.items ?? [], templates: templates.data?.items ?? [], plans: plans.data?.items ?? [] };
  const create = useApiMutation(() => api.projects.create(creationInput(draft, catalog)), { invalidate: [queryKeys.projects()], onSuccess: onCreated });
  const available = !users.isPending && !users.error && !templates.isPending && !templates.error && !plans.isPending && !plans.error;
  const validate = (at: number): boolean => {
    const local = creationErrors(draft, scope, catalog, at);
    setErrors(Object.fromEntries(Object.entries(local).map(([key, message]) => [key, t(`projects.wizard.${message}`)])));
    if (Object.keys(local).length === 0) return true;
    setStep(BASIC_FIELDS.some((field) => local[field]) ? 0 : 1);
    return false;
  };
  const next = () => { if (available && validate(step)) setStep((current) => Math.min(2, current + 1)); };
  const submit = async () => {
    if (busy.current || !available || !validate(2)) return;
    busy.current = true;
    try { await create.mutateAsync(); }
    catch (error) {
      const fields = creationServerErrors(error); setErrors(fields);
      if (Object.keys(fields).length) setStep(BASIC_FIELDS.some((field) => fields[field]) ? 0 : 1);
    } finally { busy.current = false; }
  };
  const setField = (field: CreationField, value: string) => {
    if (busy.current) return;
    setDraft((current) => ({ ...current, [field]: value, ...(field === 'kind' ? { template: '' } : {}) }));
    setErrors((current) => ({ ...current, [field]: undefined })); create.reset();
  };
  return { draft, step, errors, catalog, available, create, users, templates, plans, setField, next, submit, back: () => setStep((current) => Math.max(0, current - 1)) };
}
