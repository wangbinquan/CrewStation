import type { ReactElement } from 'react';
import type { ReleaseDto, SlotDto } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { shortId } from '../../../shared/project/releaseTimeline';
import { ConfirmationPanel } from '../../../shared/ui/ConfirmationPanel';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import type { SlotLifecycle } from '../model/useSlotLifecycle';

interface RedeployConfirmProps {
  readonly release: ReleaseDto;
  /** 此刻的待命槽：确认时带上它上面的版本，别人先换过时服务端拒绝。 */
  readonly standby: SlotDto | undefined;
  readonly lifecycle: SlotLifecycle;
  /** 有发布在进行、页上另有写操作、部署记录未确认时不能确认。 */
  readonly blocked: boolean;
  readonly onClose: () => void;
}

/**
 * 从发布记录重新部署到待验证版本的确认（RFC-021 M5、B4）：写清要部署的版本、会被替换的待命版本，
 * 以及不重新构建、不重跑迁移、按当前生产配置部署。失败时面板保留，原因显示在版本卡下。
 */
export function RedeployConfirm({ release, standby, lifecycle, blocked, onClose }: RedeployConfirmProps): ReactElement {
  const t = useT(), replacing = standby?.releaseId ? standby.tag ?? shortId(standby.releaseId) : undefined;
  const confirm = async () => { if (await lifecycle.redeploy(release, standby)) onClose(); };
  return <ConfirmationPanel question={t('release.redeploy.question', { tag: release.tag })} hint={t('release.redeploy.hint')}
    confirmLabel={t('release.redeploy.confirm', { tag: release.tag })} cancelLabel={t('release.redeploy.cancel')}
    busy={lifecycle.pending === 'redeploy'} confirmDisabled={blocked || !release.redeployable} onConfirm={() => void confirm()} onCancel={onClose}>
    <DefinitionList items={[
      { label: t('release.redeploy.target'), value: <>{release.tag} · <code>{release.commitSha.slice(0, 7)}</code> · {release.branch}</> },
      { label: t('release.redeploy.replacing'), value: replacing ? t('release.redeploy.replacingValue', { tag: replacing }) : t('release.redeploy.emptyStandby') },
    ]} />
  </ConfirmationPanel>;
}
