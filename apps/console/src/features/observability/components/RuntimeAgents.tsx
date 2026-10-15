import type { ObservationModelRow } from '@crewstation/contracts';
import { observationBuiltinProtocol } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Stack } from '../../../shared/ui/Stack';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import { useObservation } from '../hooks/useObservation';
import { countText, durationText } from '../model/runtimeFormat';
import type { RuntimePeriod, RuntimeScope } from '../model/runtimeSearch';
import { scopeProjectId } from '../model/runtimeSearch';
import { UsageCost, UsageNotes, UsageTokens } from './RuntimeUsage';
import styles from './RuntimeStatistics.module.css';

/** Agent 与模型：窗口内按逻辑 Agent 汇总；按算力档位 × 实际模型汇总并标出未定价。 */
export function RuntimeAgents({ scope, period }: { scope: RuntimeScope; period: RuntimePeriod }) {
  const t = useT(), projectId = scopeProjectId(scope);
  const agents = useObservation(['agents', projectId ?? 'system'], period, (window) => api.observability.agents(projectId, window));
  const models = useObservation(['models', projectId ?? 'system'], period, (window) => api.observability.models(projectId, window));
  const agentPage = agents.error ? undefined : agents.data, modelPage = models.error ? undefined : models.data;
  return <Stack>
    <Card title={t('runtime.agents')} footer={agentPage?.truncated ? t('runtime.truncatedList', { count: countText(agentPage.items.length) }) : t('runtime.agentsHint')}>
      <QueryStatus isPending={agents.isPending} error={agents.error} isEmpty={agentPage?.items.length === 0} emptyTitle={t('runtime.empty')} />
      {agentPage?.items.length ? <DataTable className={styles.table} columns={[t('runtime.column.agent'), t('runtime.column.tasks'), t('runtime.column.calls'),
        t('runtime.column.busy'), t('runtime.column.tokens'), t('runtime.column.cost')]}>
        {agentPage.items.map((row) => <tr key={row.agentKey}>
          <td>{row.agentLabel}<span className={styles.identity}>{row.agentKey}</span></td>
          <td>{countText(row.tasks)}</td>
          <td>{countText(row.usage.calls)}<UsageNotes usage={row.usage} /></td>
          <td>{durationText(row.durationMs)}</td>
          <td><UsageTokens usage={row.usage} /></td>
          <td><UsageCost usage={row.usage} /></td>
        </tr>)}
      </DataTable> : null}
    </Card>
    <Card title={t('runtime.models')} footer={modelPage?.truncated ? t('runtime.truncatedList', { count: countText(modelPage.items.length) }) : t('runtime.modelsHint')}>
      <QueryStatus isPending={models.isPending} error={models.error} isEmpty={modelPage?.items.length === 0} emptyTitle={t('runtime.empty')} />
      {modelPage?.items.length ? <DataTable className={styles.table} columns={[t('runtime.column.profile'), t('runtime.column.model'), t('runtime.column.calls'),
        t('runtime.column.tokens'), t('runtime.column.cost')]}>
        {modelPage.items.map((row) => <ModelRow key={`${row.profileId ?? ''}\u0000${row.model}`} row={row} system={scope.kind === 'system'} />)}
      </DataTable> : null}
    </Card>
  </Stack>;
}

function ModelRow({ row, system }: { row: ObservationModelRow; system: boolean }) {
  const t = useT(), builtin = observationBuiltinProtocol(row.profileId);
  const profile = builtin !== null ? t('runtime.builtinProfile', { protocol: builtin }) : row.profileName ?? t('runtime.nameUnavailable');
  return <tr>
    <td>{profile}<span className={styles.identity}>{row.protocol}</span></td>
    <td>{row.model || t('runtime.unknownModel')}</td>
    <td>{countText(row.usage.calls)}<UsageNotes usage={row.usage} /></td>
    <td><UsageTokens usage={row.usage} /></td>
    <td><UsageCost usage={row.usage} />{system && row.usage.unpricedCalls > 0 && row.model
      ? <ButtonLink size="small" to="/admin/compute" search={{ tab: 'pricing', q: row.model }}>{t('runtime.configurePricing')}</ButtonLink> : null}</td>
  </tr>;
}
