import type { CapabilityDescriptionDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { CapabilitySection } from './CapabilitySection';
import { CapabilityTable } from './CapabilityTable';
import { CopyValue } from './CopyValue';
import { PairList } from './PairList';
import styles from './CapabilityRuntime.module.css';

export interface CapabilityQuotaProps {
  readonly quota: CapabilityDescriptionDto['quota'];
  readonly plan: CapabilityDescriptionDto['plan'];
}

/** 并发配额与服务套餐：两者都可能尚未设置，缺省状态要明说而不是显示 0。 */
export function CapabilityQuota({ quota, plan }: CapabilityQuotaProps): ReactElement {
  const t = useT();
  return (
    <CapabilitySection title={t('capabilities.quota.title')} note={t('capabilities.quota.note')}>
      {quota === undefined ? (
        <p className={styles.muted}>{t('capabilities.quota.none')}</p>
      ) : (
        <PairList
          pairs={[
            { label: t('capabilities.quota.maxConcurrentTasks'), value: String(quota.maxConcurrentTasks) },
            { label: t('capabilities.quota.running'), value: String(quota.running) },
          ]}
        />
      )}
      <h3 className={styles.title}>{t('capabilities.plan.title')}</h3>
      {plan === undefined ? (
        <p className={styles.muted}>{t('capabilities.plan.none')}</p>
      ) : (
        <PairList
          pairs={[
            { label: t('capabilities.plan.name'), value: plan.name },
            { label: t('capabilities.plan.cpu'), value: plan.cpu },
            { label: t('capabilities.plan.memory'), value: plan.memory },
            { label: t('capabilities.plan.maxReplicas'), value: String(plan.maxReplicas) },
          ]}
        />
      )}
    </CapabilitySection>
  );
}

/** 两个平台 MCP 服务器：地址直接复制进 Agent 的 MCP 设置。 */
export function CapabilityMcp({ mcp }: { readonly mcp: CapabilityDescriptionDto['mcp'] }): ReactElement {
  const t = useT();
  return (
    <CapabilitySection title={t('capabilities.mcp.title')} note={t('capabilities.mcp.note')}>
      <CapabilityTable
        rows={mcp}
        rowKey={(row) => row.name}
        empty={t('capabilities.mcp.empty')}
        columns={[
          { header: t('capabilities.mcp.name'), cell: (row) => row.name },
          { header: t('capabilities.mcp.url'), cell: (row) => <CopyValue value={row.url} label={row.name} /> },
        ]}
      />
    </CapabilitySection>
  );
}

/** 业务子任务接口：业务程序据此发起并协调业务执行 Agent。 */
export function CapabilityBusinessTaskApi({ endpoints }: { readonly endpoints: CapabilityDescriptionDto['businessTaskApi'] }): ReactElement {
  const t = useT();
  return (
    <CapabilitySection title={t('capabilities.businessTaskApi.title')} note={t('capabilities.businessTaskApi.note')}>
      <CapabilityTable
        rows={endpoints}
        rowKey={(row) => `${row.method} ${row.path}`}
        empty={t('capabilities.businessTaskApi.empty')}
        columns={[
          { header: t('capabilities.businessTaskApi.method'), cell: (row) => <code>{row.method}</code> },
          { header: t('capabilities.businessTaskApi.path'), cell: (row) => <CopyValue value={row.path} label={row.path} /> },
          { header: t('capabilities.businessTaskApi.summary'), cell: (row) => row.summary },
        ]}
      />
    </CapabilitySection>
  );
}
