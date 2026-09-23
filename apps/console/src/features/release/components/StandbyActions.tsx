import type { ReactElement, ReactNode } from 'react';
import type { ReleaseDto, SlotDto } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { InlineConfirm } from '../../../shared/ui/InlineConfirm';
import { periodText } from '../model/useSlotLifecycle';
import type { SlotLifecycle } from '../model/useSlotLifecycle';

interface StandbyActionsProps {
  readonly slot: SlotDto;
  readonly lifecycle: SlotLifecycle;
  /** 页上另有写操作、有发布在进行、部署记录未确认时禁用。 */
  readonly disabled: boolean;
}

/**
 * 待验证卡上负责人与管理员的两个动作（RFC-021 M8、M19、M23）：推迟一个周期（可反复）、立即下线。
 * 下线删掉工作负载、不可恢复，只能从发布记录重新部署，所以是红色并要行内确认；两者排在卡片底部操作条的访问入口之后。
 */
export function StandbyActions({ slot, lifecycle, disabled }: StandbyActionsProps): ReactElement {
  const t = useT(), retention = slot.retention, period = retention ? periodText(retention) : undefined, tag = slot.tag ?? '';
  const busy = disabled || !!lifecycle.pending;
  return <>
    {period ? <Button disabled={busy} onClick={() => void lifecycle.postpone(slot)}>
      {lifecycle.pending === 'postpone' ? t('release.lifecycle.postponing') : t(`release.lifecycle.postpone.${period.unit}`, { count: period.count })}
    </Button> : null}
    <InlineConfirm variant="danger" label={t('release.lifecycle.offline')} busy={busy} {...(lifecycle.pending === 'offline' ? { busyLabel: t('release.lifecycle.offlining') } : {})}
      question={t('release.lifecycle.offlineQuestion', { tag })} confirmLabel={t('release.lifecycle.offlineConfirm', { tag })} onConfirm={() => void lifecycle.takeOffline(slot)} />
  </>;
}

/**
 * 待验证卡上负责人的动作：有版本时是推迟与下线（排在访问入口之后）；已下线且那个版本还能重新部署时，
 * 「重新部署」就是这张卡的主动作（蓝色、排最左）。不是负责人或管理员（`lifecycle` 为空）时什么都不画。
 */
export function standbyLifecycle(slot: SlotDto | undefined, releases: readonly ReleaseDto[], lifecycle: SlotLifecycle | undefined, disabled: boolean, onRedeploy: (releaseId: string) => void): { readonly primary?: ReactNode; readonly actions?: ReactNode } {
  if (!lifecycle || !slot) return {};
  if (slot.releaseId) return { actions: <StandbyActions slot={slot} lifecycle={lifecycle} disabled={disabled} /> };
  const gone = slot.offline ? releases.find((release) => release.id === slot.offline!.releaseId) : undefined;
  return gone?.redeployable ? { primary: <RedeployShortcut release={gone} disabled={disabled || !!lifecycle.pending} onRedeploy={onRedeploy} /> } : {};
}

function RedeployShortcut({ release, disabled, onRedeploy }: { readonly release: ReleaseDto; readonly disabled: boolean; readonly onRedeploy: (releaseId: string) => void }): ReactElement {
  const t = useT();
  return <Button variant="primary" disabled={disabled} onClick={() => onRedeploy(release.id)}>{t('release.redeploy.action', { tag: release.tag })}</Button>;
}
