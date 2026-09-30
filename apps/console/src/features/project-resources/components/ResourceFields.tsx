import type { ResourceField, ResourceValues } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { FormField } from '../../../shared/ui/FormField';
import { DataTable } from '../../../shared/ui/DataTable';
import { fieldLabel } from '../model/workspace';
import styles from './ResourceCenter.module.css';

export function ResourceFields({ fields, values, onChange, disabled }: { fields: ResourceField[]; values: Record<string, string | boolean>; onChange: (key: string, value: string | boolean) => void; disabled?: boolean }) {
  const t = useT();
  return <div className={styles.fields}>{fields.map((field) => <FormField key={field.key} label={fieldLabel(field, t)} hint={field.min !== undefined ? `${t('resourceCenter.range')} ${field.min}–${field.max ?? '∞'}` : undefined}>
    {field.type === 'boolean' ? <input type="checkbox" checked={values[field.key] === true} disabled={disabled} onChange={(event) => onChange(field.key, event.target.checked)} /> : field.type === 'select' ? <select value={String(values[field.key] ?? '')} disabled={disabled} onChange={(event) => onChange(field.key, event.target.value)}><option value="">{t('resourceCenter.select')}</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input type={field.type === 'number' ? 'number' : 'text'} value={String(values[field.key] ?? '')} disabled={disabled} min={field.min} max={field.max} step={field.integer ? 1 : 'any'} onChange={(event) => onChange(field.key, event.target.value)} />}
  </FormField>)}</div>;
}
export function ValueComparison({ fields, original, current, proposed }: { fields: ResourceField[]; original?: ResourceValues; current: ResourceValues; proposed: ResourceValues | Record<string, string | boolean> }) {
  const t = useT(), keys = [...new Set([...Object.keys(original ?? {}), ...Object.keys(current), ...Object.keys(proposed)])];
  const value = (v: unknown) => v === undefined || v === null || v === '' ? '—' : typeof v === 'boolean' ? t(v ? 'resourceCenter.yes' : 'resourceCenter.no') : String(v);
  return keys.length ? <DataTable columns={[t('resourceCenter.metric'), ...(original ? [t('resourceCenter.originalRequest')] : []), t('resourceCenter.current'), t('resourceCenter.target')]}>{keys.map((key) => <tr key={key}><td>{fields.find((f) => f.key === key) ? fieldLabel(fields.find((f) => f.key === key)!, t) : key}</td>{original ? <td>{value(original[key])}</td> : null}<td>{value(current[key])}</td><td>{value(proposed[key])}</td></tr>)}</DataTable> : <p className={styles.muted}>{t('resourceCenter.authorizationChange')}</p>;
}
