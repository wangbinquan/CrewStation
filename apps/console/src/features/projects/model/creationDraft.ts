import type { CreateProjectInput } from '@crewstation/api-client';
import { isApiClientError } from '@crewstation/api-client';
import type { ManifestKind, ProjectDto, ProjectTemplateDto, ServicePlanDto, UserDto } from '@crewstation/contracts';
import { ProjectDtoSchema, SlugSchema } from '@crewstation/contracts';

export type CreationScope = 'digital-worker' | 'integration';
export interface CreationDraft { name: string; slug: string; ownerUserId: string; kind: ManifestKind; template: string; plan: string; maxConcurrentTasks: string }
export type CreationField = keyof CreationDraft;
export type CreationErrors = Partial<Record<CreationField, string>>;
export interface CreationCatalog { users: readonly UserDto[]; templates: readonly ProjectTemplateDto[]; plans: readonly ServicePlanDto[] }
export const BASIC_FIELDS: readonly CreationField[] = ['name', 'slug', 'ownerUserId', 'kind'];
const ALL_FIELDS: readonly CreationField[] = [...BASIC_FIELDS, 'template', 'plan', 'maxConcurrentTasks'];
export const creationKinds = (scope: CreationScope): readonly ManifestKind[] => scope === 'integration' ? ['APIProxy', 'EventProducer'] : ['DigitalWorker'];
export const initialCreationDraft = (scope: CreationScope): CreationDraft => ({ name: '', slug: '', ownerUserId: '', kind: scope === 'integration' ? 'APIProxy' : 'DigitalWorker', template: '', plan: '', maxConcurrentTasks: '' });

/** 返回文案键，组件在当前语言下呈现；每个错误都有对应字段。 */
export function creationErrors(draft: CreationDraft, scope: CreationScope, catalog: CreationCatalog, step: number): CreationErrors {
  const errors: CreationErrors = {};
  if (!draft.name.trim() || draft.name.trim().length > 80) errors.name = 'nameError';
  if (!SlugSchema.safeParse(draft.slug.trim()).success) errors.slug = 'slugError';
  if (!catalog.users.some((user) => user.id === draft.ownerUserId)) errors.ownerUserId = 'ownerError';
  if (!creationKinds(scope).includes(draft.kind)) errors.kind = 'kindError';
  if (step > 0) {
    if (!catalog.templates.some((template) => template.id === draft.template && template.kind === draft.kind)) errors.template = 'templateError';
    if (!catalog.plans.some((plan) => plan.id === draft.plan)) errors.plan = 'planError';
    if (draft.maxConcurrentTasks.trim() !== '' && (!/^\d+$/.test(draft.maxConcurrentTasks) || Number(draft.maxConcurrentTasks) < 1 || Number(draft.maxConcurrentTasks) > 100)) errors.maxConcurrentTasks = 'quotaError';
  }
  return errors;
}

export function creationInput(draft: CreationDraft, catalog: CreationCatalog): CreateProjectInput {
  const owner = catalog.users.find((user) => user.id === draft.ownerUserId);
  if (!owner) throw new Error('负责人尚未确认');
  return { name: draft.name.trim(), slug: draft.slug.trim(), ownerUserId: owner.id, kind: draft.kind, template: draft.template, plan: draft.plan,
    ...(draft.maxConcurrentTasks.trim() === '' ? {} : { maxConcurrentTasks: Number(draft.maxConcurrentTasks) }) };
}

/** 开通页只接续本次请求对应的有效项目；不把未知回执解释成已经创建成功。 */
export function confirmedCreationResult(result: unknown, input: CreateProjectInput): ProjectDto | undefined {
  const parsed = ProjectDtoSchema.safeParse(result);
  if (!parsed.success) return undefined;
  const project = parsed.data;
  if (project.name !== input.name || project.slug !== input.slug || project.kind !== (input.kind ?? 'DigitalWorker') || project.ownerUserId !== input.ownerUserId) return undefined;
  return project;
}

/** 保留服务端字段信息；未知错误留在表单级，不猜测失败字段。 */
export function creationServerErrors(error: unknown): CreationErrors {
  if (!isApiClientError(error)) return {};
  const errors: CreationErrors = {};
  const field = error.details.field;
  if (ALL_FIELDS.includes(field as CreationField)) errors[field as CreationField] = error.message;
  if (Array.isArray(error.details.issues)) for (const item of error.details.issues) {
    if (item && typeof item === 'object' && ALL_FIELDS.includes(item.path) && typeof item.message === 'string') errors[item.path as CreationField] = item.message;
  }
  return errors;
}
