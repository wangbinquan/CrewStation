import type { Change, Draft, Entry, Field } from './model';

const more: Record<string, Field[]> = {
  namespace: [
    { key: 'memory', label: '内存请求总量', value: 16, used: 7.2, unit: 'GiB' },
    { key: 'pods', label: 'Pod 数', value: 30, used: 9, unit: '个' },
    { key: 'pvcs', label: 'PVC 数', value: 20, used: 3, unit: '个' },
  ],
  objects: [
    { key: 'objectMax', label: '单对象大小上限', value: 2, unit: 'GiB' },
    { key: 'transfers', label: '并发传输', value: 4, used: 2, unit: '个' },
  ],
  'rate-limit': [
    { key: 'sourceBurst', label: '服务域每来源突发上限', value: 100, unit: '次' },
    { key: 'targetRate', label: '服务域总速率', value: 500, unit: '次/s' },
    { key: 'targetBurst', label: '服务域总突发上限', value: 1000, unit: '次' },
    { key: 'userRate', label: '用户域每用户速率', value: 30, unit: '次/s' },
    { key: 'userBurst', label: '用户域每用户突发上限', value: 60, unit: '次' },
    { key: 'hostRate', label: '用户域总速率', value: 300, unit: '次/s' },
    { key: 'hostBurst', label: '用户域总突发上限', value: 600, unit: '次' },
  ],
  'service-policy': [{ key: 'scope', label: '服务规格范围', value: '继承平台默认', unit: '', options: ['继承平台默认', '继承平台默认 + 高内存服务规格'] }],
  dev: [{ key: 'plan', label: '开发任务套餐', value: '标准 · 1 CPU / 2 GiB / 10 GiB', unit: '', options: ['标准 · 1 CPU / 2 GiB / 10 GiB', '增强 · 2 CPU / 4 GiB / 20 GiB'] }],
  tasks: [{ key: 'plan', label: '业务任务套餐', value: '标准 · 1 CPU / 2 GiB / 10 GiB', unit: '', options: ['标准 · 1 CPU / 2 GiB / 10 GiB', '增强 · 2 CPU / 4 GiB / 20 GiB'] }],
};
export function fieldsFor(entry: Entry): Field[] {
  const q = entry.quota;
  const fields: Field[] = q ? [{ key: 'limit', label: q.label, value: q.limit, used: q.used, unit: q.unit }] : [];
  return [...fields, ...(more[entry.id] ?? [])].map((field) => ({ ...field, value: entry.settings?.[field.key] ?? field.value }));
}
export function draftFor(entry: Entry): Draft {
  return { reason: '', values: Object.fromEntries(fieldsFor(entry).map((field) => [field.key, field.value])) };
}
export function changesFor(entry: Entry, draft: Draft): Change[] {
  return fieldsFor(entry).flatMap((field) => {
    const after = draft.values[field.key] ?? field.value;
    return after === field.value ? [] : [{ key: field.key, label: field.label, before: field.value, after, unit: field.unit }];
  });
}
export function validationFor(entry: Entry, draft: Draft, grant: boolean): string | undefined {
  if (draft.reason.trim().length < 5) return '请填写至少 5 个字的用途或变更理由。';
  if (grant) return undefined;
  if (!changesFor(entry, draft).length) return '请至少修改一项配置。';
  for (const field of fieldsFor(entry)) {
    const value = draft.values[field.key];
    if (typeof field.value === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) return `${field.label}需要大于 0。`;
    if (field.used !== undefined && typeof value === 'number' && value < field.used && entry.id === 'objects') return `${field.label}不能低于当前占用 ${field.used} ${field.unit}。`;
    if (field.unit === '个' && typeof value === 'number' && !Number.isInteger(value)) return `${field.label}需要填写整数。`;
  }
  return undefined;
}
export const changeSummary = (changes: Change[], side: 'before' | 'after') => changes.map((c) => `${c.label} ${c[side]}${c.unit ? ` ${c.unit}` : ''}`).join('；');

export function metricsFor(entry: Entry, partial = false): Array<[string, string]> {
  if (partial && ['objects', 'namespace', 'volumes'].includes(entry.id)) return [['用量', '未知 · 采集暂不可用'], ['策略', '最近一次有效值'], ['采集', '距今 12 分钟']];
  const settings = entry.settings ?? {};
  if (entry.id === 'agents') return [['占额', '2 个 · 共享项目执行池'], ...entry.metrics.slice(1)];
  if (entry.id === 'erp') return [entry.metrics[0]!, ['限流', '共享服务域每来源桶'], entry.metrics[2]!];
  if (entry.id === 'namespace') return [['CPU 请求', `3.5 / ${entry.quota?.limit} 核`], ['内存请求', `7.2 / ${settings.memory ?? 16} GiB`], ['对象数', `Pod 9 / ${settings.pods ?? 30} · PVC 3 / ${settings.pvcs ?? 20}`]];
  if (entry.id === 'objects') return [['占用', `13.6 / ${entry.quota?.limit} GiB`], ['其中预留', '1.2 GiB'], ['单对象 / 并发', `${settings.objectMax ?? 2} GiB / ${settings.transfers ?? 4} 个`]];
  if (entry.id === 'rate-limit') return [['用户域', `${settings.userRate ?? 30}/s · 总 ${settings.hostRate ?? 300}/s`], ['服务域', `${entry.quota?.limit}/s · 总 ${settings.targetRate ?? 500}/s`], ['来源', entry.source]];
  if (entry.quota) return [[entry.quota.label, `${entry.quota.used} / ${entry.quota.limit} ${entry.quota.unit}`], ...entry.metrics.slice(1)];
  if (settings.plan) return [['后续执行', String(settings.plan)], ...entry.metrics.slice(1)];
  if (settings.scope) return [['规格范围', String(settings.scope)], ...entry.metrics.slice(1)];
  return entry.metrics;
}
