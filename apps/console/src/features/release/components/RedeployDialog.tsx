import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ReleaseDto, SlotDto } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { shortId } from '../../../shared/project/releaseTimeline';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { FormField } from '../../../shared/ui/FormField';
import { ConfirmationDialog } from '../../../shared/ui/dialog/ConfirmationDialog';
import { redeployCandidates } from '../model/redeployCandidates';
import type { SlotLifecycle } from '../model/useSlotLifecycle';

interface RedeployDialogProps {
  /** 打开时预选的版本：待验证卡给刚下线的那个，发布记录时间线与发布详情给所点的那个。 */
  readonly release: ReleaseDto;
  /** 本服务的发布记录：可重新部署的都能在下拉里改选（2026-09-23 裁定）。 */
  readonly releases: readonly ReleaseDto[];
  /** 此刻的待命槽：确认时带上它上面的版本，别人先换过时服务端拒绝。 */
  readonly standby: SlotDto | undefined;
  readonly lifecycle: SlotLifecycle;
  /** 有发布在进行、页上另有写操作、部署记录未确认时不能确认。 */
  readonly blocked: boolean;
  readonly onClose: () => void;
}

/**
 * 部署到待验证版本的确认弹窗（RFC-021 M5、B4）：第一行选要部署的版本（可重新部署的版本，新到旧；2026-09-23 裁定），
 * 写清会被替换的待命版本，以及不重新构建、不重跑迁移、按当前生产配置部署。失败时弹窗留着，原因显示在弹窗里；改选版本清掉上一次的失败。
 */
export function RedeployDialog({ release, releases, standby, lifecycle, blocked, onClose }: RedeployDialogProps): ReactElement {
  const t = useT(), [failed, setFailed] = useState(false), [selectedId, setSelectedId] = useState<string>(release.id);
  const chosen = releases.find((item) => item.id === selectedId) ?? release, listed = redeployCandidates(releases, selectedId);
  const options = listed.some((item) => item.id === chosen.id) ? listed : [chosen, ...listed], busy = lifecycle.pending === 'redeploy';
  const replacing = standby?.releaseId ? standby.tag ?? shortId(standby.releaseId) : undefined;
  const confirm = async () => { setFailed(false); if (await lifecycle.redeploy(chosen, standby)) onClose(); else setFailed(true); };
  return <ConfirmationDialog size="medium" title={t('release.redeploy.dialogTitle')} question={t('release.redeploy.question', { tag: chosen.tag })} hint={t('release.redeploy.hint')}
    confirmLabel={t('release.redeploy.confirm', { tag: chosen.tag })} cancelLabel={t('release.redeploy.cancel')}
    busy={busy} confirmDisabled={blocked || !chosen.redeployable} onConfirm={() => void confirm()} onCancel={onClose}>
    <FormField label={t('release.redeploy.target')}>
      <select name="redeployRelease" value={chosen.id} disabled={busy} onChange={(event) => { setSelectedId(event.target.value); setFailed(false); }}>
        {options.map((item) => <option key={item.id} value={item.id}>{[item.tag, item.commitSha.slice(0, 7), item.branch, t(`release.status.${item.status}`)].join(' · ')}</option>)}
      </select>
    </FormField>
    <DefinitionList items={[{ label: t('release.redeploy.replacing'), value: replacing ? t('release.redeploy.replacingValue', { tag: replacing }) : t('release.redeploy.emptyStandby') }]} />
    {failed && lifecycle.error ? <ActionNote tone="error">{lifecycle.error}</ActionNote> : null}
  </ConfirmationDialog>;
}
