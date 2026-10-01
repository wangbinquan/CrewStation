import type { ProjectResourceNode, ResourceActionDescriptor, ResourceField, ResourceQuotaMetric, ResourceValues } from '@crewstation/contracts';
import type { Translate } from '../../../shared/lib/useT';
import { normalizeResourceDomain, resourceDomain } from './domains';

export type CenterView = 'topology' | 'list' | 'requests';
export interface CenterSearch { view?: CenterView; category?: string; access?: string; q?: string; node?: string; request?: string }
export function parseCenterSearch(raw: Record<string, unknown>): CenterSearch {
  const text = (key: string, max = 240) => typeof raw[key] === 'string' ? String(raw[key]).slice(0, max) : undefined;
  return { view: ['topology', 'list', 'requests'].includes(String(raw['view'])) ? raw['view'] as CenterView : undefined,
    category: normalizeResourceDomain(String(raw['category'])),
    access: ['owned', 'requestable', 'pending', 'unavailable'].includes(String(raw['access'])) ? text('access') : undefined, q: text('q', 120), node: text('node', 500), request: text('request') };
}
export function matches(node: ProjectResourceNode, search: CenterSearch): boolean {
  return (!search.category || resourceDomain(node) === normalizeResourceDomain(search.category)) && (!search.access || (search.access === 'pending' ? node.pendingRequestIds.length > 0 || node.access === 'pending' : node.access === search.access))
    && (!search.q || `${node.name} ${node.description} ${node.resourceId ?? ''} ${node.resourceType}`.toLocaleLowerCase().includes(search.q.toLocaleLowerCase()));
}
export const isInFlight = (state: string) => ['pending', 'approved', 'applying', 'needs-review', 'apply-failed', 'requested'].includes(state);
export function label(t: Translate, key: string, fallback: string): string { const value = t(`resourceCenter.${key}`); return value === `resourceCenter.${key}` ? fallback : value; }
export const numberText = (value: number | null) => value === null ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
export function metricLimit(metric: ResourceQuotaMetric, t: Translate) { return metric.limitKind === 'value' ? `${numberText(metric.limit)} ${metric.unit}` : t(`resourceCenter.limit.${metric.limitKind}`); }
export function metricLabel(metric: ResourceQuotaMetric, t: Translate) { return label(t, `field.${metric.key}`, metric.label); }
export function fieldLabel(field: ResourceField, t: Translate) { return `${label(t, `field.${field.key}`, field.label)}${field.unit ? ` (${field.unit})` : ''}`; }
export function actionLabel(action: ResourceActionDescriptor, t: Translate) {
  if (action.kind === 'catalog-policy') return t('resourceCenter.catalogPolicy');
  if (action.target?.action === 'set-default') return t(action.target.resourceType === 'gateway-limit' ? 'resourceCenter.restoreDefault' : 'resourceCenter.setDefault');
  return t(`resourceCenter.action.${action.kind}.${action.target?.action ?? 'configure'}`);
}
export interface ResourceDraft { values: Record<string, string | boolean>; reason: string; key: string }
export function initialDraft(values: ResourceValues): ResourceDraft { return { values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'boolean' ? v : v === null ? '' : String(v)])), reason: '', key: crypto.randomUUID() }; }
export function formValues(fields: ResourceField[], draft: ResourceDraft): ResourceValues {
  const result: ResourceValues = {};
  for (const field of fields) {
    const raw = draft.values[field.key] ?? ''; if (raw === '' && field.required) throw new Error(field.label);
    if (field.type === 'number') { const value = Number(raw); if (!Number.isFinite(value) || (field.integer && !Number.isInteger(value)) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) throw new Error(field.label); result[field.key] = value; }
    else if (field.type === 'boolean') result[field.key] = raw === true;
    else result[field.key] = String(raw);
  }
  return result;
}
