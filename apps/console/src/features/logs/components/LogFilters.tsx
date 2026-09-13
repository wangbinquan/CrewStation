import type { LogSource, SlotName } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import type { LogFilterValues } from '../hooks/useLogFeed';
import { FilterSelect } from './FilterSelect';
import styles from './LogFilters.module.css';

const SOURCES: readonly LogSource[] = ['slot', 'dev-session', 'business-task', 'build', 'migration'];
const SLOTS: readonly SlotName[] = ['preview', 'prod'];
const LIMITS: readonly number[] = [100, 200, 500, 1000];

export interface LogFiltersProps {
  readonly value: LogFilterValues;
  readonly onChange: (next: LogFilterValues) => void;
  readonly follow: boolean;
  readonly onFollowChange: (follow: boolean) => void;
}

/** 筛选条：来源、部署槽与每页条数决定请求，关键字只过滤已取回的这一页。 */
export function LogFilters({ value, onChange, follow, onFollowChange }: LogFiltersProps): ReactElement {
  const t = useT();
  const slotOptions = [{ value: '', label: t('logs.filters.slotAll') }, ...SLOTS.map((slot) => ({ value: slot, label: t(`logs.slot.${slot}`) }))];
  return (
    <div className={styles.bar}>
      <FilterSelect
        label={t('logs.filters.source')}
        value={value.source}
        options={SOURCES.map((source) => ({ value: source, label: t(`logs.source.${source}`) }))}
        onChange={(next) => onChange({ ...value, source: next as LogSource })}
      />
      <FilterSelect
        label={t('logs.filters.slot')}
        value={value.slot}
        options={slotOptions}
        disabled={value.source !== 'slot'}
        title={t('logs.filters.slotHint')}
        onChange={(next) => onChange({ ...value, slot: next as SlotName | '' })}
      />
      <FilterSelect
        label={t('logs.filters.limit')}
        value={String(value.limit)}
        options={[...new Set([...LIMITS, value.limit])].sort((a, b) => a - b).map((limit) => ({ value: String(limit), label: String(limit) }))}
        onChange={(next) => onChange({ ...value, limit: Number(next) })}
      />
      <label className={styles.field}>
        {t('logs.filters.text')}
        <input
          className={styles.input}
          type="search"
          value={value.text}
          placeholder={t('logs.filters.textPlaceholder')}
          onChange={(event) => onChange({ ...value, text: event.target.value })}
        />
      </label>
      <Button
        className={styles.follow}
        variant={follow ? 'primary' : 'secondary'}
        aria-pressed={follow}
        title={t('logs.follow.hint')}
        onClick={() => onFollowChange(!follow)}
      >
        {follow ? t('logs.follow.on') : t('logs.follow.off')}
      </Button>
      {(['taskId', 'releaseId', 'since'] as const).map((field) => value[field] ? <Button key={field} className={styles.context} onClick={() => onChange({ ...value, [field]: undefined })} title={t('logs.filters.clearContext')}><span>{field}: {value[field]} ×</span></Button> : null)}
    </div>
  );
}
