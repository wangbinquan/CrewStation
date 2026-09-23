import { TraceIdSchema } from '@crewstation/contracts';
import { useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { FormField } from '../../../shared/ui/FormField';
import { TRACE_SOURCES, TRACE_STATUSES, TRACE_WINDOWS } from '../model/traceView';
import type { TraceFilters } from '../model/traceView';
import styles from './Trace.module.css';

/** 三个筛选：来源、状态、时间范围（按有活动算）；值都是「全部」或一个取值。 */
export function TraceFilterBar({ filters, onChange }: { readonly filters: TraceFilters; readonly onChange: (next: TraceFilters) => void }): ReactElement {
  const t = useT();
  const all = t('traces.filter.all');
  // 选「全部」时值为空串，对应的筛选项就不带。
  const set = (patch: { readonly source?: string; readonly status?: string; readonly window?: string }) => {
    const next = { source: filters.source ?? '', status: filters.status ?? '', window: filters.window, ...patch };
    const source = TRACE_SOURCES.find((value) => value === next.source), status = TRACE_STATUSES.find((value) => value === next.status);
    onChange({ ...(source ? { source } : {}), ...(status ? { status } : {}), window: TRACE_WINDOWS.find((value) => value === next.window) ?? 'all' });
  };
  return <div className={styles.filters}>
    <FormField label={t('traces.filter.source')}>
      <select value={filters.source ?? ''} onChange={(event) => set({ source: event.target.value })}>
        <option value="">{all}</option>
        {TRACE_SOURCES.map((value) => <option key={value} value={value}>{t(`traces.source.${value}`)}</option>)}
      </select>
    </FormField>
    <FormField label={t('traces.filter.status')}>
      <select value={filters.status ?? ''} onChange={(event) => set({ status: event.target.value })}>
        <option value="">{all}</option>
        {TRACE_STATUSES.map((value) => <option key={value} value={value}>{t(`traces.status.${value}`)}</option>)}
      </select>
    </FormField>
    <FormField label={t('traces.filter.window')}>
      <select value={filters.window} title={t('traces.filter.windowHint')} onChange={(event) => set({ window: event.target.value })}>
        {TRACE_WINDOWS.map((value) => <option key={value} value={value}>{t(`traces.window.${value}`)}</option>)}
      </select>
    </FormField>
  </div>;
}

/** 粘贴完整 trace_id 直接打开（日志、事件投递、业务代码里的 CS_TRACE_ID）；格式不对时留在输入框里说明。 */
export function TraceOpenForm({ onOpen }: { readonly onOpen: (traceId: string) => void }): ReactElement {
  const t = useT(), [draft, setDraft] = useState(''), [invalid, setInvalid] = useState(false);
  const errorId = useId(), field = useRef<HTMLInputElement>(null);
  return <form className={styles.open} onSubmit={(event) => {
    event.preventDefault();
    const result = TraceIdSchema.safeParse(draft.trim().toLowerCase());
    setInvalid(!result.success);
    if (result.success) { onOpen(result.data); setDraft(''); } else field.current?.focus();
  }}>
    <FormField label={t('traces.open.label')} errorId={errorId} error={invalid ? t('traces.open.invalid') : undefined}>
      <input ref={field} value={draft} placeholder={t('traces.open.placeholder')} aria-invalid={invalid} aria-errormessage={invalid ? errorId : undefined} spellCheck={false}
        onChange={(event) => { setDraft(event.target.value); if (invalid) setInvalid(false); }} />
    </FormField>
    <Button type="submit">{t('traces.open.submit')}</Button>
  </form>;
}
