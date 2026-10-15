import type { ObservationCall } from '@crewstation/contracts';
import { observationBuiltinProtocol } from '@crewstation/contracts';
import type { RefObject } from 'react';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { DataTable } from '../../../shared/ui/DataTable';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { Stack } from '../../../shared/ui/Stack';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import type { Translate } from '../../../shared/lib/useT';
import { STATUS_TONE, TOKEN_BUCKETS, callCostText, callDurationMs, callTokenText, countText, durationText, modelCostText, tokenTotal } from '../model/runtimeFormat';
import styles from './RuntimeStatistics.module.css';

/** 执行所用的算力档位；没有档位的平台执行显示协议内置价格线。 */
export function callProfileText(call: Pick<ObservationCall, 'profileId' | 'profileName' | 'profileRevision' | 'protocol'>, t: Translate): string {
  const builtin = observationBuiltinProtocol(call.profileId);
  if (builtin !== null) return t('runtime.builtinProfile', { protocol: builtin });
  return `${call.profileName ?? t('runtime.nameUnavailable')}${call.profileRevision === null ? '' : ` · r${call.profileRevision}`}`;
}

export function CallStatus({ call }: { call: Pick<ObservationCall, 'status'> }) {
  const t = useT();
  return <Badge tone={STATUS_TONE[call.status]}>{t('runtime.status.' + call.status)}</Badge>;
}

/** 一次执行的完整记录：身份、时间、用量完整性与按模型拆分。 */
export function RuntimeCallDialog({ call, asOf, costVisible, returnFocusTo, onClose }: {
  call: ObservationCall; asOf: string; costVisible: boolean; returnFocusTo?: RefObject<HTMLElement | null>; onClose: () => void;
}) {
  const t = useT(), dateText = useDateText('second');
  const attempt = call.attempt === null ? '' : ` · ${t('runtime.attempt', { attempt: call.attempt })}`;
  return <Dialog title={`${call.agentLabel}${attempt}`} size="large" onClose={onClose} {...(returnFocusTo ? { returnFocusTo } : {})}>
    <Stack data-runtime-call={call.id}>
      <DefinitionList layout="grid" items={[
        { label: t('runtime.column.status'), value: <CallStatus call={call} /> },
        { label: t('runtime.column.task'), value: call.taskLabel },
        { label: t('runtime.column.kind'), value: t('runtime.kind.' + call.kind) },
        { label: t('runtime.column.profile'), value: `${callProfileText(call, t)} · ${call.protocol}` },
        { label: t('runtime.column.start'), value: dateText(call.startedAt) },
        { label: t('runtime.column.end'), value: call.endedAt ? dateText(call.endedAt) : t('runtime.status.running') },
        { label: t('runtime.column.duration'), value: durationText(callDurationMs(call, asOf)) },
        { label: t('runtime.column.usage'), value: t('runtime.usageState.' + call.usageState) },
        { label: t('runtime.column.tokens'), value: callTokenText(call, tokenTotal(call)) },
        { label: t('runtime.column.cost'), value: callCostText(call, costVisible, t) },
      ]} />
      <p className={styles.hint}>{t('runtime.usageStateHint.' + call.usageState)}</p>
      <CallModels call={call} costVisible={costVisible} />
    </Stack>
  </Dialog>;
}

function CallModels({ call, costVisible }: { call: ObservationCall; costVisible: boolean }) {
  const t = useT();
  if (!call.models.length) return <EmptyState title={t('runtime.noModels')} description={t('runtime.usageStateHint.' + call.usageState)} />;
  return <DataTable className={styles.table} columns={[t('runtime.column.model'), ...TOKEN_BUCKETS.map((bucket) => t('runtime.bucket.' + bucket)), t('runtime.bucket.reasoning'), t('runtime.column.cost')]}>
    {call.models.map((model) => <tr key={model.model}>
      <td>{model.model || t('runtime.unknownModel')}</td>
      {TOKEN_BUCKETS.map((bucket) => <td key={bucket}>{countText(model[bucket])}</td>)}
      <td>{countText(model.reasoning)}</td>
      <td>{modelCostText(model.costNano, costVisible, t)}</td>
    </tr>)}
  </DataTable>;
}
