import type { ProjectDto } from '@crewstation/contracts';
import type { CreateProjectInput } from '@crewstation/api-client';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import type { CreationCatalog, CreationErrors, CreationField, CreationScope } from '../model/creationDraft';
import { BASIC_FIELDS, confirmedCreationResult, creationErrors, creationInput, creationServerErrors, initialCreationDraft } from '../model/creationDraft';

export function useProjectCreation(scope: CreationScope, onCreated: (project: ProjectDto) => void) {
  const t = useT(), busy = useRef(false);
  const [draft, setDraft] = useState(() => initialCreationDraft(scope)), [step, setStep] = useState(0), [errors, setErrors] = useState<CreationErrors>({});
  const [accepted, setAccepted] = useState<ProjectDto>(), [resultError, setResultError] = useState<string>();
  const epoch = useRef(0), delivered = useRef<string>(undefined);
  useEffect(() => { const generation = epoch.current + 1; epoch.current = generation; return () => { epoch.current = generation + 1; }; }, []);
  useEffect(() => {
    if (accepted && delivered.current !== accepted.id) { delivered.current = accepted.id; onCreated(accepted); }
  }, [accepted, onCreated]);
  const users = useApiQuery(queryKeys.users(), () => api.users.list());
  const templates = useApiQuery(queryKeys.projectTemplates(), () => api.catalog.listProjectTemplates());
  const plans = useApiQuery(queryKeys.servicePlans(), () => api.catalog.listServicePlans());
  const catalog: CreationCatalog = { users: (users.data?.items ?? []).filter((user) => user.platformRole !== 'user'), templates: templates.data?.items ?? [], plans: plans.data?.items ?? [] };
  const create = useApiMutation((input: CreateProjectInput) => api.projects.create(input), { invalidate: [queryKeys.projects()] });
  const available = !accepted && !users.isPending && !users.isFetching && !users.error && !templates.isPending && !templates.isFetching && !templates.error && !plans.isPending && !plans.isFetching && !plans.error;
  const dirty = !accepted && (create.isPending || JSON.stringify(draft) !== JSON.stringify(initialCreationDraft(scope)));
  const validate = (at: number): boolean => {
    const local = creationErrors(draft, scope, catalog, at);
    setErrors(Object.fromEntries(Object.entries(local).map(([key, message]) => [key, t(`projects.wizard.${message}`)])));
    if (Object.keys(local).length === 0) return true;
    setStep(BASIC_FIELDS.some((field) => local[field]) ? 0 : 1);
    return false;
  };
  const next = () => { if (!busy.current && available && validate(step)) setStep(Math.min(2, step + 1)); };
  const submit = async () => {
    if (busy.current || !available || !validate(2)) return;
    busy.current = true; setResultError(undefined);
    const generation = epoch.current, input = creationInput(draft, catalog);
    try {
      const result = await create.mutateAsync(input);
      if (epoch.current !== generation) return;
      const confirmed = confirmedCreationResult(result, input);
      if (confirmed) setAccepted(confirmed);
      else setResultError(t('projects.wizard.resultUnknown'));
    }
    catch (error) {
      if (epoch.current !== generation) return;
      const fields = creationServerErrors(error); setErrors(fields);
      if (Object.keys(fields).length) setStep(BASIC_FIELDS.some((field) => fields[field]) ? 0 : 1);
    } finally { busy.current = false; }
  };
  const setField = (field: CreationField, value: string) => {
    if (busy.current || accepted) return;
    setDraft((current) => ({ ...current, [field]: value, ...(field === 'kind' ? { template: '' } : {}) }));
    setErrors((current) => ({ ...current, [field]: undefined })); create.reset(); setResultError(undefined);
  };
  return { draft, step, errors, catalog, available, dirty, resultError, create, users, templates, plans, setField, next, submit, back: () => { if (!busy.current && !accepted) setStep(Math.max(0, step - 1)); } };
}
