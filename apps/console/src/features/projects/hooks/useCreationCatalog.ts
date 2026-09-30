import { useState } from 'react';
import type { ManifestKind } from '@crewstation/contracts';
import { BUILTIN_RESOURCES, ProjectCreationCatalogSchema } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import type { CreationCatalog, CreationDraft, CreationScope } from '../model/creationDraft';
import { initialCreationDraft } from '../model/creationDraft';

/** 默认值来自当前平台目录；自动重读不禁用已显示的表单，也不覆盖用户选择。 */
export function useCreationCatalog(scope: CreationScope, self: boolean, open: boolean) {
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const settings = useApiQuery(['project-creation'], async () => ProjectCreationCatalogSchema.parse(await api.catalog.projectCreation()), { enabled: open });
  const users = useApiQuery(queryKeys.users(), () => api.users.list(), { enabled: open && !self });
  const templates = useApiQuery(queryKeys.projectTemplates(), () => api.catalog.listProjectTemplates(), { enabled: open && !self });
  const plans = useApiQuery(queryKeys.servicePlans(), () => api.catalog.listServicePlans(), { enabled: open && !self });
  const catalog: CreationCatalog = { users: self ? (me.data ? [me.data] : []) : (users.data?.items ?? []).filter((user) => user.platformRole !== 'user'),
    templates: self ? settings.data?.templates ?? [] : templates.data?.items ?? [], plans: plans.data?.items ?? [] };
  const error = me.error ?? settings.error ?? (self ? undefined : users.error ?? templates.error ?? plans.error);
  const pending = me.isPending || settings.isPending || (!self && (users.isPending || templates.isPending || plans.isPending));
  const available = !error && !pending && (me.data?.isAdmin || (self && me.data?.platformRole === 'developer'));
  const defaults = (kind = initialCreationDraft(scope).kind): CreationDraft => {
    const choices = catalog.templates.filter((template) => template.kind === kind);
    const preferred = kind === 'DigitalWorker' ? BUILTIN_RESOURCES.minimalTemplate : kind === 'APIProxy' ? BUILTIN_RESOURCES.proxyTemplate : BUILTIN_RESOURCES.eventTemplate;
    const template = choices.find((item) => item.id === preferred) ?? choices[0];
    return { ...initialCreationDraft(scope), kind, ownerUserId: catalog.users.find((user) => user.id === me.data?.id)?.id ?? '', template: template?.id ?? '', plan: settings.data?.defaultServicePlan ?? '' };
  };
  return { me, catalog, settings: settings.data, error, pending, available, defaults };
}

export function useCreationDraft(defaults: (kind?: ManifestKind) => CreationDraft) {
  const [edits, setEdits] = useState<Partial<CreationDraft>>({});
  return { draft: { ...defaults(edits.kind), ...edits }, setEdits, resetDraft: () => setEdits({}) };
}
