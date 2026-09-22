import type { HealthState, SlotDto } from '@crewstation/contracts';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../lib/useT';
import { Badge } from '../ui/Badge';
import type { BadgeTone } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { slotCanOpen, slotIdentityKnown } from './deployedSlot';
import styles from './DeployedVersionCard.module.css';

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
}

const STATE_TONE: Readonly<Record<string, BadgeTone>> = { ready: 'success', deploying: 'info', degraded: 'warning', failed: 'danger', empty: 'neutral', unknown: 'neutral' };
const HEALTH_TONE: Readonly<Record<HealthState, BadgeTone>> = { healthy: 'success', degraded: 'warning', 'crash-looping': 'danger', unhealthy: 'danger', unknown: 'neutral' };

/**
 * 正式／待验证版本卡：概览与发布页共用一个组件、一套文案（RFC-020 §8）。
 * 标签作标题，下一行提交与副本，底部地址与访问入口；访问入口只在实际就绪时出现。
 */
export function DeployedVersionCard({ role, slot, known, onSelect, health, sha = 'full', actions }: DeployedVersionCardProps): ReactElement {
  const t = useT(), identity = known && slotIdentityKnown(slot), empty = known && (!slot || slot.state === 'empty') && !slot?.releaseId;
  const state = known ? slot?.state ?? 'empty' : 'unknown';
  const badges = <>
    <Badge tone={state === 'ready' && identity ? 'success' : STATE_TONE[state] ?? 'neutral'}>{t(`slot.state.${state}`)}</Badge>
    {health !== undefined && !empty ? <Badge tone={HEALTH_TONE[health]}>{t(`slot.health.${health}`)}</Badge> : null}
  </>;
  return <Card compact title={t(`slot.${role}`)} extra={badges}>
    {empty ? <p className={styles.note}>{t('slot.empty')}</p> : !identity ? <p className={styles.note}>{t('slot.unknown')}</p> : <div className={styles.version}>
      {onSelect ? <Button variant="ghost" className={styles.tagButton} title={t('slot.select')} onClick={() => onSelect(slot!.releaseId!)}>{slot!.tag}</Button> : <div className={styles.tag}>{slot!.tag}</div>}
      <div className={styles.meta}>
        <span>SHA <code title={slot!.commitSha}>{sha === 'short' ? slot!.commitSha!.slice(0, 7) : slot!.commitSha}</code></span>
        <span>{t('slot.replicas', { ready: slot!.readyReplicas, total: slot!.replicas })}</span>
      </div>
      <div className={styles.footer}>
        <span className={styles.host}>{slot!.host}</span>
        <span className={styles.actions}>
          {slotCanOpen(slot) ? <a className={styles.open} href={`//${slot!.host}`} target="_blank" rel="noreferrer">{t(`slot.open.${role}`)}</a> : <span className={styles.note}>{t('slot.notReady')}</span>}
          {actions}
        </span>
      </div>
    </div>}
  </Card>;
}
