import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ReleaseDto, SlotDto } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { shortId } from '../../../shared/project/releaseTimeline';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { ConfirmationDialog } from '../../../shared/ui/dialog/ConfirmationDialog';
import type { SlotLifecycle } from '../model/useSlotLifecycle';

interface RedeployDialogProps {
  readonly release: ReleaseDto;
  /** 此刻的待命槽：确认时带上它上面的版本，别人先换过时服务端拒绝。 */
  readonly standby: SlotDto | undefined;
  readonly lifecycle: SlotLifecycle;
  /** 有发布在进行、页上另有写操作、部署记录未确认时不能确认。 */
  readonly blocked: boolean;
  readonly onClose: () => void;
}

/**
 * 从发布记录重新部署到待验证版本的确认弹窗（RFC-021 M5、B4）：写清要部署的版本、会被替换的待命版本，
 * 以及不重新构建、不重跑迁移、按当前生产配置部署。失败时弹窗留着，原因显示在弹窗里。
 */
export function RedeployDialog({ release, standby, lifecycle, blocked, onClose }: RedeployDialogProps): ReactElement {
  const t = useT(), [failed, setFailed] = useState(false), replacing = standby?.releaseId ? standby.tag ?? shortId(standby.releaseId) : undefined;
  const confirm = async () => { setFailed(false); if (await lifecycle.redeploy(release, standby)) onClose(); else setFailed(true); };
  return <ConfirmationDialog size="medium" title={t('release.redeploy.action', { tag: release.tag })} question={t('release.redeploy.question', { tag: release.tag })} hint={t('release.redeploy.hint')}
    confirmLabel={t('release.redeploy.confirm', { tag: release.tag })} cancelLabel={t('release.redeploy.cancel')}
    busy={lifecycle.pending === 'redeploy'} confirmDisabled={blocked || !release.redeployable} onConfirm={() => void confirm()} onCancel={onClose}>
    <DefinitionList items={[
      { label: t('release.redeploy.target'), value: <>{release.tag} · <code>{release.commitSha.slice(0, 7)}</code> · {release.branch}</> },
      { label: t('release.redeploy.replacing'), value: replacing ? t('release.redeploy.replacingValue', { tag: replacing }) : t('release.redeploy.emptyStandby') },
    ]} />
    {failed && lifecycle.error ? <ActionNote tone="error">{lifecycle.error}</ActionNote> : null}
  </ConfirmationDialog>;
}
