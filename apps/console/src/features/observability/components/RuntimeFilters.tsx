import { useState } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Stack } from '../../../shared/ui/Stack';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { FormField } from '../../../shared/ui/FormField';
import { Button } from '../../../shared/ui/Button';
import type { RuntimeStatisticsQuery } from '@crewstation/contracts';
import type { RuntimeSearch } from '../model/runtimeSearch';
import { localDateInput } from '../model/runtimeSearch';
import styles from './RuntimeStatistics.module.css';
export function RuntimeFilters({ window, search, states, change }: { window: RuntimeStatisticsQuery; search: RuntimeSearch; states: string[]; change: (s: RuntimeSearch) => void }) {
  const t = useT(), [from, setFrom] = useState(localDateInput(window.from)), [to, setTo] = useState(localDateInput(window.to)), [error, setError] = useState(false);
  const apply = () => { const a = Date.parse(from), b = Date.parse(to); if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b) { setError(true); return; } setError(false); change({ ...search, from: new Date(a).toISOString(), to: new Date(b).toISOString() }); };
  return <Stack><ActionRow className={styles.filters}>
    <FormField label={t('runtime.start')}><input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></FormField>
    <FormField label={t('runtime.end')}><input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></FormField>
    <Button onClick={apply}>{t('runtime.apply')}</Button>
    {[1, 7, 30].map((days) => <Button key={days} variant="ghost" onClick={() => { const now = Date.now(); change({ ...search, from: new Date(now - days * 86400000).toISOString(), to: new Date(now).toISOString() }); }}>{t('runtime.days', { days })}</Button>)}
  </ActionRow>{error ? <p role="alert">{t('runtime.invalidRange')}</p> : null}
  <ActionRow className={styles.filters}><FormField label={t('runtime.search')}><input type="search" value={search.q ?? ''} onChange={(e) => change({ ...search, q: e.target.value || undefined })} /></FormField>
    <FormField label={t('runtime.state')}><select value={search.state ?? ''} onChange={(e) => change({ ...search, state: e.target.value || undefined })}><option value="">{t('runtime.all')}</option>{states.map((state) => <option key={state} value={state}>{t('runtime.state.' + state)}</option>)}</select></FormField>
    {search.quality ? <Button variant="ghost" onClick={() => change({ ...search, quality: undefined })}>{t('runtime.clearQuality')}</Button> : null}
  </ActionRow></Stack>;
}
