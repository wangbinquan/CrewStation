import type { ReactElement } from 'react';
import type { RateLimitBucket, RateLimits } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { DefinitionList } from '../../../../shared/ui/DefinitionList';
import { AdminField } from '../AdminField';
import type { RateLimitDraft, RateLimitErrors, RateLimitGroup } from '../../model/rateLimitDraft';
import { RATE_LIMIT_FIELDS } from '../../model/rateLimitDraft';

const isBucket = (value: unknown): value is RateLimitBucket => typeof value === 'object' && value !== null && 'average' in value;

/** 一组限流的现值（RFC-025 T10）：每只桶写平均与突发，平台接口另写同时处理的上限；tag 标出来源（平台默认、单独设置）。 */
export function RateLimitFacts<G extends RateLimitGroup>({ group, limits, tag }: { readonly group: G; readonly limits: RateLimits[G]; readonly tag?: string }): ReactElement {
  const t = useT();
  const items = Object.entries(limits).map(([bucket, value]) => ({
    label: t(`admin.settings.rateLimits.bucket.${group}.${bucket}`),
    value: isBucket(value) ? t('admin.settings.rateLimits.bucket', { average: value.average, burst: value.burst }) : t('admin.settings.rateLimits.inFlight', { count: value as number }),
  }));
  return <section aria-label={t(`admin.settings.rateLimits.group.${group}`)}>
    <h4>{t(`admin.settings.rateLimits.group.${group}`)}{tag ? ` · ${tag}` : ''}</h4>
    <DefinitionList items={items} />
  </section>;
}

/** 一组限流的输入框：标签、范围提示与错误都按「组.字段」取；值是字符串，提交前由 validateRateLimits 窄化。 */
export function RateLimitFields({ group, draft, errors, disabled, onChange }: {
  readonly group: RateLimitGroup; readonly draft: RateLimitDraft; readonly errors: RateLimitErrors; readonly disabled: boolean; readonly onChange: (key: string, value: string) => void;
}): ReactElement {
  const t = useT();
  const hint = (field: string) => t(`admin.settings.rateLimits.hint.${field.endsWith('.average') ? 'average' : field.endsWith('.burst') ? 'burst' : 'inFlight'}`);
  return <fieldset>
    <legend>{t(`admin.settings.rateLimits.group.${group}`)}</legend>
    {RATE_LIMIT_FIELDS[group].map((field) => {
      const key = `${group}.${field}`;
      return <AdminField key={key} label={t(`admin.settings.rateLimits.field.${key}`)} hint={hint(field)} inputMode="numeric" value={draft[key] ?? ''} disabled={disabled}
        {...(errors[key] ? { error: t(errors[key]) } : {})} onChange={(value) => onChange(key, value)} />;
    })}
  </fieldset>;
}
