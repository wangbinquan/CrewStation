import type { HealthState, MaintenanceDto, SlotDto } from '@crewstation/contracts';
import type { ReactElement, ReactNode } from 'react';
import { useDateText } from '../lib/useDateText';
import { useT } from '../lib/useT';
import { Badge } from '../ui/Badge';
import type { BadgeTone } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { slotCanOpen, slotIdentityKnown } from './deployedSlot';
import styles from './DeployedVersionCard.module.css';
import { ExternalButtonLink } from '../ui/navigation/ButtonLink';

export interface DeployedVersionCardProps {
  readonly role: 'prod' | 'preview';
  readonly slot?: SlotDto;
  /** 部署记录已读到且一致；否则一律显示「状态未确认」而不是猜。 */
  readonly known: boolean;
  /** 给了就在标签上挂选择动作（发布页），不给则标签是普通文字（概览）。 */
  readonly onSelect?: (releaseId: string) => void;
  /** 运行健康（概览从摘要拿到）；缺省不画健康角标。 */
  readonly health?: HealthState;
  /** 发布页要核对完整 SHA，概览只要前 7 位并把完整值放在 title 里。 */
  readonly sha?: 'full' | 'short';
  /** 底部访问入口旁的额外动作（上线／回退、继续开发等）。 */
  readonly actions?: ReactNode;
  /** 正式版本维护中（RFC-021）：角标与原因，概览与发布页一致；没有维护或读不到时不画。 */
  readonly maintenance?: MaintenanceDto | null;
  /** 待验证卡的到期提示或下线说明下面的动作（发布页给负责人的推迟、下线、重新部署）。 */
  readonly lifecycle?: ReactNode;
}

const STATE_TONE: Readonly<Record<string, BadgeTone>> = { ready: 'success', deploying: 'info', degraded: 'warning', failed: 'danger', empty: 'neutral', offline: 'neutral', unknown: 'neutral' };
const HEALTH_TONE: Readonly<Record<HealthState, BadgeTone>> = { healthy: 'success', degraded: 'warning', 'crash-looping': 'danger', unhealthy: 'danger', unknown: 'neutral' };

/**
 * 正式／待验证版本卡：概览与发布页共用一个组件、一套文案（RFC-020 §8）。
 * 标签作标题，下一行提交与副本，底部地址与访问入口；访问入口只在实际就绪时出现。
 */
export function DeployedVersionCard({ role, slot, known, onSelect, health, sha = 'full', actions, maintenance, lifecycle }: DeployedVersionCardProps): ReactElement {
  const t = useT(), date = useDateText(), identity = known && slotIdentityKnown(slot), empty = known && (!slot || slot.state === 'empty') && !slot?.releaseId;
  const offline = empty ? slot?.offline : undefined;
  const state = known ? offline ? 'offline' : slot?.state ?? 'empty' : 'unknown';
  const underMaintenance = role === 'prod' && known && !!maintenance;
  const badges = <>
    {underMaintenance ? <Badge tone="warning">{t('slot.maintenance.badge')}</Badge> : null}
    <Badge tone={state === 'ready' && identity ? 'success' : STATE_TONE[state] ?? 'neutral'}>{t(`slot.state.${state}`)}</Badge>
    {health !== undefined && !empty ? <Badge tone={HEALTH_TONE[health]}>{t(`slot.health.${health}`)}</Badge> : null}
  </>;
  const retention = role === 'preview' && identity ? slot!.retention : undefined;
  return <Card compact title={t(`slot.${role}`)} extra={badges}>
    {underMaintenance ? <p className={styles.notice}>{t('slot.maintenance.reason', { reason: maintenance!.reason })}{maintenance!.expectedEndAt ? ` · ${t('slot.maintenance.until', { time: date(maintenance!.expectedEndAt) })}` : ''}</p> : null}
    {offline ? <div className={styles.version}>
      <p className={styles.note}>{t('slot.offline.line', { tag: offline.tag ?? t('slot.offline.unknownTag'), reason: t(`slot.offline.reason.${offline.reason}`), time: date(offline.at) })}</p>
      {lifecycle}
    </div> : empty ? <p className={styles.note}>{t('slot.empty')}</p> : !identity ? <p className={styles.note}>{t('slot.unknown')}</p> : <div className={styles.version}>
      {onSelect ? <Button variant="ghost" className={styles.tagButton} title={t('slot.select')} onClick={() => onSelect(slot!.releaseId!)}>{slot!.tag}</Button> : <div className={styles.tag}>{slot!.tag}</div>}
      <div className={styles.meta}>
        <span>SHA <code title={slot!.commitSha}>{sha === 'short' ? slot!.commitSha!.slice(0, 7) : slot!.commitSha}</code></span>
        <span>{t('slot.replicas', { ready: slot!.readyReplicas, total: slot!.replicas })}</span>
      </div>
      {retention ? <p className={styles.notice}>{t(`slot.retention.${retention.kind}`, { time: date(retention.deadline) })}{retention.remindedAt ? ` · ${t('slot.retention.reminded', { time: date(retention.remindedAt) })}` : ''}</p> : null}
      {lifecycle}
      <div className={styles.footer}>
        <span className={styles.host}>{slot!.host}</span>
        <span className={styles.actions}>
          {slotCanOpen(slot) ? <ExternalButtonLink href={`//${slot!.host}`}>{t(`slot.open.${role}`)}</ExternalButtonLink> : <span className={styles.note}>{t('slot.notReady')}</span>}
          {actions}
        </span>
      </div>
    </div>}
  </Card>;
}
