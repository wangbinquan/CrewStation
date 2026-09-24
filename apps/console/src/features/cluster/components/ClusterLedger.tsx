// RFC-025 T13（I29 裁定）：台账认领的对象在集群清单上显示所属标准记录——阶段与原因照记录写，操作经资源中心受理。
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ClusterLedger, ResourceActionId } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { resourcePhaseTone } from '../../../shared/resources/resourcePhaseTone';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { ConfirmDialog } from '../../../shared/ui/dialog/ConfirmDialog';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import styles from './Cluster.module.css';

/** 不可撤销的记录操作：结束工作区、删除工作卷，都要输入确认词。 */
const DESTRUCTIVE: ReadonlySet<ResourceActionId> = new Set(['release', 'delete-volume']);

/** 清单「状态」一格：标准阶段作徽标，集群观测到的状态短语退为小字；原因先用记录的，没有再用观测到的。 */
export function LedgerStatus({ ledger, observed, reason }: { ledger: ClusterLedger; observed: string; reason: string }): ReactElement {
  const t = useT(), text = ledger.reason?.message || reason;
  return <><Badge tone={resourcePhaseTone(ledger.phase)}>{t(`resources.phase.${ledger.phase}`)}</Badge><small>{t('cluster.ledger.observed', { phase: observed })}</small>{text ? <small className={styles.reason} title={text}>{text}</small> : null}</>;
}

/**
 * 详情里的「资源中心记录」：种类、阶段与原因，外加记录的可做操作。操作带着记录版本受理，记录已经变了就拒绝（请刷新再试）；
 * 做完让详情重读，阶段随之更新。
 */
export function LedgerRecordPanel({ ledger, name, onDone }: { ledger: ClusterLedger; name: string; onDone: () => void }): ReactElement {
  const t = useT(), [confirming, setConfirming] = useState<ResourceActionId>();
  const act = useApiMutation((action: ResourceActionId) => api.resources.act(ledger.id, action, { expectedVersion: ledger.version }), { onSuccess: () => { setConfirming(undefined); onDone(); } });
  const run = (action: ResourceActionId) => { act.reset(); if (DESTRUCTIVE.has(action)) setConfirming(action); else act.mutate(action); };
  return <div className={styles.stack} data-ledger-record={ledger.id}>
    <p><strong>{t('cluster.ledger.record')}</strong> · {t(`cluster.ledger.kind.${ledger.kind}`)} · <Badge tone={resourcePhaseTone(ledger.phase)}>{t(`resources.phase.${ledger.phase}`)}</Badge>{ledger.maintained ? <small className={styles.muted}> {t('cluster.ledger.maintained')}</small> : null}</p>
    {ledger.reason ? <p className={styles.muted}>{ledger.reason.message}{ledger.reason.hint ? ` ${ledger.reason.hint}` : ''}</p> : null}
    {ledger.actions.length ? <div className={styles.actions}>{ledger.actions.map((action) => <div className={styles.action} key={action.id}><Button variant={DESTRUCTIVE.has(action.id) ? 'danger' : 'secondary'} onClick={() => run(action.id)} disabled={!action.enabled || act.isPending}>{t(`cluster.ledger.action.${action.id}`)}</Button>{!action.enabled && action.disabledReason ? <small className={styles.muted}>{action.disabledReason}</small> : null}</div>)}</div> : null}
    {confirming ? <ConfirmDialog title={t(`cluster.ledger.action.${confirming}`)} question={t('cluster.ledger.confirm', { action: t(`cluster.ledger.action.${confirming}`), name })} confirmWord="delete" confirmLabel={t('cluster.confirm')} cancelLabel={t('cluster.cancel')}
      busy={act.isPending} onConfirm={() => act.mutate(confirming)} onCancel={() => { setConfirming(undefined); act.reset(); }}>
      {confirming === 'delete-volume' ? <p>{t('cluster.reclaim.consequence')}</p> : null}
      <QueryStatus isPending={false} error={act.error} />
    </ConfirmDialog> : <QueryStatus isPending={false} error={act.error} />}
  </div>;
}
