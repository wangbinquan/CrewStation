import { useEffect, useRef } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery, errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { useServiceMaintenance } from '../../../shared/project/useServiceMaintenance';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Button } from '../../../shared/ui/Button';
import { deployedVersions, slotCanOpen, trafficSnapshotMatches } from '../model/deployedVersions';
import type { DeployedVersions } from '../model/deployedVersions';
import { useMaintenanceEditor } from '../model/useMaintenanceEditor';
import type { ReleaseActions } from '../model/useReleaseActions';
import { useSlotLifecycle } from '../model/useSlotLifecycle';
import { useTrafficConfirmation } from '../model/useTrafficConfirmation';
import { isInFlight } from '../model/releaseStatus';
import { DeployedVersionCard } from '../../../shared/project/DeployedVersionCard';
import { MaintenancePanel } from './MaintenancePanel';
import { RedeployDialog } from './RedeployDialog';
import { standbyLifecycle } from './StandbyActions';
import { TrafficSwitchDialog } from './TrafficSwitchDialog';
import styles from './DeploymentVersions.module.css';

interface DeploymentVersionsProps {
  readonly projectId: string;
  readonly serviceId: string;
  /** 负责人与平台管理员：切流，以及下线、推迟、重新部署与维护（RFC-021 M8–M10 与切流同一身份）。 */
  readonly canSwitch: boolean;
  readonly actions: ReleaseActions;
  readonly onSelect: (id: string) => void;
  readonly autoCheck?: boolean;
  /** 页面上正在确认重新部署的发布（时间线、发布详情或已下线的待验证卡发起）。 */
  readonly redeployId?: string;
  readonly onRedeploy: (releaseId: string) => void;
  readonly onRedeployClose: () => void;
}

/**
 * 两张版本卡；上线／回退按钮在待验证卡上，核对后弹出确认弹窗（RFC-020 §6；2026-09-23 起页内面板改弹窗）。
 * `autoCheck`：概览「上线 vX…」带 `switch=1` 进入时立即核对一次。进入维护、重新部署同样是弹窗。
 */
export function DeploymentVersions({ projectId, serviceId, canSwitch, actions, onSelect, autoCheck = false, redeployId, onRedeploy, onRedeployClose }: DeploymentVersionsProps) {
  const t = useT();
  // 部署记录每 5 秒在原位重读，回到前台补读；页面不提供刷新按钮（2026-09-23 裁定）。
  const slots = useApiQuery(queryKeys.slots(serviceId), () => api.services.listSlots(serviceId), { refetchIntervalMs: 5_000, refetchOnWindowFocus: true });
  const releases = useApiQuery(queryKeys.releases(serviceId), () => api.services.listReleases(serviceId));
  const maintenance = useServiceMaintenance(serviceId), lifecycle = useSlotLifecycle(projectId, serviceId, actions);
  const maintenanceEditor = useMaintenanceEditor(maintenance.current, actions);
  const inProgress = !releases.error ? releases.data?.items.find((release) => isInFlight(release.status)) : undefined;
  let versions: DeployedVersions = {}, readError: string | undefined;
  try { if (slots.data) versions = deployedVersions(slots.data.items); } catch (cause) { readError = t(errorMessage(cause)); }
  const known = !!slots.data && !slots.error && !readError;
  const p = useTrafficConfirmation(projectId, serviceId, canSwitch, actions, slots.refetch), snapshot = p.snapshot;
  const stale = !!snapshot && (!known || !!releases.error || !!inProgress || !trafficSnapshotMatches(snapshot, versions));
  // 上线还是回退，在核对前按发布记录的创建时间预判（确认面板以核对快照为准）。
  const items = releases.error ? [] : releases.data?.items ?? [], target = items.find((release) => release.id === versions.preview?.releaseId), current = items.find((release) => release.id === versions.prod?.releaseId);
  const rollbackGuess = !!target && !!current && Date.parse(target.createdAt) < Date.parse(current.createdAt);
  const lifecycleBlocked = !!actions.busy || !known || releases.isPending || !!releases.error || !!inProgress;
  const blocked = lifecycleBlocked || !slotCanOpen(versions.preview);
  const autoDone = useRef(false);
  useEffect(() => { if (!autoCheck || autoDone.current || !canSwitch || blocked || snapshot || p.checking) return; autoDone.current = true; void p.check(); }, [autoCheck, canSwitch, blocked, snapshot, p]);
  const switchAction = canSwitch
    ? <Button variant="primary" disabled={blocked || p.checking} onClick={() => void p.check()}>{t(p.checking ? 'release.traffic.checking' : rollbackGuess ? 'release.traffic.rollbackAction' : 'release.traffic.goLiveAction', { tag: versions.preview?.tag ?? '—' })}</Button>
    : <span className={styles.note}>{t('release.traffic.ownerOnly')}</span>;
  const enterMaintenance = canSwitch && known && maintenance.current === null && !!versions.prod?.releaseId
    ? <Button disabled={!!actions.busy} onClick={maintenanceEditor.open}>{t('release.maintenance.enterAction')}</Button> : undefined;
  const standby = known ? standbyLifecycle(versions.preview, items, canSwitch ? lifecycle : undefined, lifecycleBlocked, onRedeploy) : {};
  const redeployTarget = canSwitch && redeployId ? items.find((release) => release.id === redeployId) : undefined;
  return <section className={styles.section} aria-label={t('release.versions.title')}>
    {slots.isPending ? <p>{t('release.versions.loading')}</p> : null}
    {slots.error || readError ? <ActionNote tone="error">{slots.error ? errorMessage(slots.error) : readError}</ActionNote> : null}
    <div className={styles.grid}>
      <DeployedVersionCard role="prod" slot={versions.prod} known={known} onSelect={onSelect} maintenance={maintenance.current} actions={enterMaintenance} />
      <DeployedVersionCard role="preview" slot={versions.preview} known={known} onSelect={onSelect} primary={known && !!versions.preview?.releaseId ? switchAction : standby.primary} actions={standby.actions} />
    </div>
    {lifecycle.error ? <ActionNote tone="error">{lifecycle.error}</ActionNote> : null}
    {lifecycle.done ? <ActionNote tone="success">{lifecycle.done}</ActionNote> : null}
    {redeployTarget ? <RedeployDialog key={redeployTarget.id} release={redeployTarget} releases={items} standby={versions.preview} lifecycle={lifecycle} blocked={lifecycleBlocked} onClose={onRedeployClose} /> : null}
    <MaintenancePanel projectId={projectId} serviceId={serviceId} canManage={canSwitch} actions={actions} maintenance={maintenance} editor={maintenanceEditor} />
    <p className={styles.note}>{t('release.versions.sharedData')}</p>
    {inProgress ? <ActionNote tone="neutral">{t('release.traffic.inProgress', { tag: inProgress.tag })} <Button onClick={() => onSelect(inProgress.id)}>{t('release.traffic.openInProgress')}</Button></ActionNote> : null}
    {canSwitch && snapshot ? <TrafficSwitchDialog traffic={p} snapshot={snapshot} stale={stale} recheckBlocked={blocked} confirmBlocked={!!actions.busy || !canSwitch} /> : null}
    {actions.busy ? <ActionNote tone="neutral">{t('release.actions.busy')}</ActionNote> : null}
    {p.error && !snapshot ? <ActionNote tone="error">{p.error} {t('release.traffic.recovery')}</ActionNote> : null}
    {p.done ? <ActionNote tone="success">{p.done}</ActionNote> : null}
  </section>;
}
