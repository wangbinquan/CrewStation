import { useState } from 'react';
import type { ReactElement } from 'react';
import type { MaintenanceDto } from '@crewstation/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiQuery } from '../../../shared/api/useApi';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { shortId } from '../../../shared/project/releaseTimeline';
import type { useServiceMaintenance } from '../../../shared/project/useServiceMaintenance';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { InlineConfirm } from '../../../shared/ui/InlineConfirm';
import { blockingText, fullMaintenanceWindow } from '../model/maintenanceDraft';
import type { ReleaseActions } from '../model/useReleaseActions';
import { MaintenanceForm } from './MaintenanceForm';
import styles from './Maintenance.module.css';

interface MaintenancePanelProps {
  readonly projectId: string;
  readonly serviceId: string;
  /** 负责人与平台管理员（RFC-021 M8、M9）。 */
  readonly canManage: boolean;
  readonly actions: ReleaseActions;
  readonly maintenance: ReturnType<typeof useServiceMaintenance>;
  /** 表单开着（「进入维护」按钮在正式版本卡上，所以开关状态由版本区持有）。 */
  readonly editing: boolean;
  readonly onEditing: (editing: boolean) => void;
}

/**
 * 正式版本维护（RFC-021 M3、M4、M6、M7、M13）：维护中时成员都看到拦了什么、原因、预计恢复与放行名单；
 * 负责人和管理员进入、调整、退出。不在维护且没打开表单时什么都不画，入口在正式版本卡上。
 */
export function MaintenancePanel({ projectId, serviceId, canManage, actions, maintenance, editing, onEditing }: MaintenancePanelProps): ReactElement | null {
  const t = useT(), client = useQueryClient(), { query, current } = maintenance;
  const [exiting, setExiting] = useState(false), [error, setError] = useState<string>(), [done, setDone] = useState<string>();
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.maintenance(serviceId) });
  const exit = async (revision: number) => {
    if (!actions.begin('maintenance')) return;
    setExiting(true); setError(undefined); setDone(undefined);
    try { await api.services.exitMaintenance(serviceId, { expectedRevision: revision }); setDone(t('release.maintenance.exited')); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { await refresh(); setExiting(false); actions.finish('maintenance'); }
  };
  const notes = <>{error ? <ActionNote tone="error">{error}</ActionNote> : null}{done ? <ActionNote tone="success">{done}</ActionNote> : null}</>;
  if (query.error) return <ActionNote tone="error">{t('release.maintenance.readError', { message: errorMessage(query.error) })}</ActionNote>;
  if (editing && canManage && current !== undefined) {
    return <Card compact title={t(current ? 'release.maintenance.updateTitle' : 'release.maintenance.enterTitle')}>
      <MaintenanceForm projectId={projectId} serviceId={serviceId} current={current} actions={actions} onSettled={refresh} onClose={(message) => { onEditing(false); setError(undefined); setDone(message); }} />
    </Card>;
  }
  if (!current) return error || done ? <div className={styles.panel}>{notes}</div> : null;
  return <Card compact title={t('release.maintenance.activeTitle')} extra={<Badge tone="warning">{t('slot.maintenance.badge')}</Badge>}>
    <div className={styles.panel}>
      <MaintenanceFacts projectId={projectId} current={current} checkedAt={query.dataUpdatedAt} />
      {fullMaintenanceWindow(current.switches) ? <p className={styles.muted}>{t('release.maintenance.fullWindow')}</p> : null}
      {current.switches.events ? <p className={styles.muted}>{t('release.maintenance.eventsHeld')}</p> : null}
      {canManage ? <ActionRow>
        <Button disabled={!!actions.busy} onClick={() => { setDone(undefined); onEditing(true); }}>{t('release.maintenance.adjust')}</Button>
        <InlineConfirm label={t('release.maintenance.exit')} busy={exiting || !!actions.busy} {...(exiting ? { busyLabel: t('release.maintenance.exiting') } : {})}
          question={t('release.maintenance.exitQuestion')} confirmLabel={t('release.maintenance.exitConfirm')} onConfirm={() => void exit(current.revision)} />
      </ActionRow> : <p className={styles.muted}>{t('release.maintenance.ownerOnly')}</p>}
      {notes}
    </div>
  </Card>;
}

/**
 * 维护的事实：拦了什么、原因、预计恢复、谁还能进、谁何时开始；人名从成员名单解析，读不到退回短 ID。
 * 「已超过预计恢复时间」按这份维护状态的读取时间判断（每 30 秒重读）。
 */
function MaintenanceFacts({ projectId, current, checkedAt }: { readonly projectId: string; readonly current: MaintenanceDto; readonly checkedAt: number }): ReactElement {
  const t = useT(), date = useDateText();
  const members = useApiQuery(queryKeys.members(projectId), () => api.projects.listMembers(projectId));
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const nameOf = (userId: string) => (me.data?.id === userId ? me.data.name : members.data?.items.find((member) => member.userId === userId)?.name) ?? t('timeline.unknownActor', { id: shortId(userId) });
  const overdue = !!current.expectedEndAt && Date.parse(current.expectedEndAt) <= checkedAt;
  const admitted = [t('release.maintenance.admittedBase'), ...current.allowUsers.map((user) => user.name)].join(t('release.maintenance.separator'));
  return <DefinitionList items={[
    { label: t('release.maintenance.blocking'), value: blockingText(current.switches, t) },
    { label: t('release.maintenance.reason'), value: current.reason },
    { label: t('release.maintenance.until'), value: current.expectedEndAt ? `${date(current.expectedEndAt)}${overdue ? ` · ${t('release.maintenance.overdue')}` : ''}` : t('release.maintenance.untilUnset') },
    ...(current.switches.users ? [{ label: t('release.maintenance.admitted'), value: admitted }] : []),
    { label: t('release.maintenance.startedBy'), value: t('release.maintenance.actorAt', { actor: nameOf(current.startedBy), time: date(current.startedAt) }) },
    ...(current.revision > 1 ? [{ label: t('release.maintenance.updatedBy'), value: t('release.maintenance.actorAt', { actor: nameOf(current.updatedBy), time: date(current.updatedAt) }) }] : []),
  ]} />;
}
