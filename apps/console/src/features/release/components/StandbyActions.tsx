import type { ReactElement, ReactNode } from 'react';
import type { ReleaseDto, SlotDto } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { InlineConfirm } from '../../../shared/ui/InlineConfirm';
import { defaultRedeployTarget } from '../model/redeployCandidates';
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
 * 「推迟」只在服务端说能推迟时出现，即为当前到期时间发过提醒之后（2026-09-23 裁定）；推迟后到期时间后移，按钮消失到下一次提醒。
 * 下线删掉工作负载、不可恢复，只能从发布记录重新部署，所以是红色并要行内确认；两者排在卡片底部操作条的访问入口之后。
 */
export function StandbyActions({ slot, lifecycle, disabled }: StandbyActionsProps): ReactElement {
  const t = useT(), retention = slot.retention, period = retention?.postponable ? periodText(retention) : undefined, tag = slot.tag ?? '';
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
 * 待验证卡上负责人的动作：有版本时是推迟与下线（排在访问入口之后）；空着（已下线或尚未部署）且有可部署的版本时，
 * 「部署版本…」就是这张卡的主动作（蓝色、排最左）：打开重新部署确认，在里面选版本，默认选刚下线的那个（2026-09-23 裁定）。
 * 不是负责人或管理员（`lifecycle` 为空）时什么都不画。
 */
export function standbyLifecycle(slot: SlotDto | undefined, releases: readonly ReleaseDto[], lifecycle: SlotLifecycle | undefined, disabled: boolean, onRedeploy: (releaseId: string) => void): { readonly primary?: ReactNode; readonly actions?: ReactNode } {
  if (!lifecycle || !slot) return {};
  if (slot.releaseId) return { actions: <StandbyActions slot={slot} lifecycle={lifecycle} disabled={disabled} /> };
  const target = defaultRedeployTarget(slot, releases);
  return target ? { primary: <DeployVersionButton target={target} disabled={disabled || !!lifecycle.pending} onRedeploy={onRedeploy} /> } : {};
}

function DeployVersionButton({ target, disabled, onRedeploy }: { readonly target: ReleaseDto; readonly disabled: boolean; readonly onRedeploy: (releaseId: string) => void }): ReactElement {
  const t = useT();
  return <Button variant="primary" disabled={disabled} onClick={() => onRedeploy(target.id)}>{t('release.redeploy.choose')}</Button>;
}
