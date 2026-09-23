import { useCallback, useEffect, useState } from 'react';
import { formatDateTime } from '../../../shared/lib/dateFormat';
import { useI18n } from '../../../shared/lib/useI18n';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import type { DataBindingsHandle } from '../hooks/useDataBindings';
import { bindingDisplayState } from '../model/dataAccessForm';
import { bindingStateTone } from '../model/stateTone';
import { Pane } from './Pane';
import { DataAccessForm } from './data/DataAccessForm';
import { DataBindingActions } from './data/DataBindingActions';

const ignoreDirty = (_dirty: boolean) => {};
/** 授权、期限与进程使用分开表示；不根据批准记录宣称应用切到了生产数据。 */
export function DataBindingPane({ data, onDirtyChange = ignoreDirty }: { readonly data: DataBindingsHandle; readonly onDirtyChange?: (dirty: boolean) => void }) {
  const t = useT(), { locale } = useI18n();
  const [drafts, setDrafts] = useState<Record<string, boolean>>({});
  const change = useCallback((id: string, dirty: boolean) => setDrafts((current) => current[id] === dirty ? current : { ...current, [id]: dirty }), []);
  const requestDirty = useCallback((dirty: boolean) => change('request', dirty), [change]);
  const dirty = Object.values(drafts).some(Boolean);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  // 绑定记录每 5 秒自动重读，不给「刷新访问记录」（2026-09-23 裁定）。
  return <Pane title={t('devSession.data.title')}>
    <p>{t('devSession.data.modeHint')}</p><p>{t('devSession.data.developmentLifetime')}</p>
    <ActionNote tone="neutral">{t('devSession.data.approvalWarning')} {t('devSession.data.loadingUnknown')}</ActionNote>
    <QueryStatus isPending={data.isPending} error={data.loadError} />
    {data.loadError ? <ActionNote tone="neutral">{t('devSession.data.readFailed')}</ActionNote> : null}
    {data.bindings.length === 0 && !data.isPending && !data.loadError ? <p>{t('devSession.data.empty')}</p> : null}
    {data.bindings.map((binding) => {
      const state = bindingDisplayState(binding, data.checkedAt);
      return <Card compact key={binding.id} title={t(`devSession.data.mode.${binding.mode}`)} extra={<Badge tone={data.loadError ? 'neutral' : bindingStateTone(state)}>{data.loadError ? t('devSession.data.unconfirmed') : t(`devSession.data.state.${state}`)}</Badge>}>
        <details><summary>{t('devSession.data.recordDetails')} · {binding.id.slice(-8)} · {formatDateTime(binding.createdAt, locale)}</summary>
        <DefinitionList items={[
          { label: t('devSession.data.bindingId'), value: <code>{binding.id}</code> },
          { label: t('devSession.data.created'), value: formatDateTime(binding.createdAt, locale) },
          { label: t('devSession.data.requestedBy'), value: binding.requestedByName ? <span title={binding.requestedBy}>{binding.requestedByName}</span> : <code>{binding.requestedBy}</code> },
          ...(binding.mode !== 'development' ? [{ label: t('devSession.data.ttl'), value: binding.ttlMinutes === undefined ? t('devSession.data.durationUnknown') : String(binding.ttlMinutes) }] : []),
          ...(binding.reason ? [{ label: t('devSession.data.reason'), value: binding.reason }] : []),
          ...(binding.decision ? [{ label: t('devSession.data.opinion'), value: binding.decision }] : []),
          ...(binding.expiresAt ? [{ label: t('devSession.data.expiresLabel'), value: formatDateTime(binding.expiresAt, locale) }] : []),
        ]} />
        <DataBindingActions binding={binding} data={data} onDirtyChange={change} />
        </details>
      </Card>;
    })}
    <DataAccessForm data={data} onDirtyChange={requestDirty} />
  </Pane>;
}
