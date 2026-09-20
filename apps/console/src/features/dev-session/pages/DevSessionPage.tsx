import type { ReactElement } from 'react';
import { useSearch } from '@tanstack/react-router';
import { activityTargetFromSearch } from '../../../shared/activity/agentActivityView';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { OpenSessionForm } from '../components/OpenSessionForm';
import { PaneNotice } from '../components/PaneNotice';
import { ReleaseOutcome } from '../components/ReleaseOutcome';
import { RebuildSessionControl } from '../components/RebuildSessionControl';
import { useBranches } from '../hooks/useBranches';
import { useDevSession } from '../hooks/useDevSession';
import { useProjectContext } from '../hooks/useProjectContext';
import { DevSessionWorkbench } from './DevSessionWorkbench';

/**
 * 开发会话：一个项目同时最多一个长期运行的开发容器。
 * 没有会话时只给开会话的入口；有会话时整页是工作区，四个面板共用一条任务流。
 */
export function DevSessionPage(): ReactElement {
  const t = useT();
  const { projectId } = useProjectScope();
  const search = useSearch({ strict: false });
  const activityTarget = activityTargetFromSearch(projectId, search);
  const session = useDevSession(projectId);
  const branches = useBranches(projectId);
  const context = useProjectContext(projectId, session.session);
  return (
    <>
      {!session.session ? <PageHeader title={t('devSession.title')} description={[t('devSession.line1'), t('devSession.line2')]} /> : null}
      {session.isPending ? <PaneNotice tone="muted">{t('devSession.loading')}</PaneNotice> : null}
      {session.loadError !== null ? <PaneNotice tone="warning">{errorMessage(session.loadError)} <Button disabled={session.refreshing} onClick={() => void session.refresh()}>{t('devSession.connection.check')}</Button></PaneNotice> : null}
      {activityTarget && session.missing ? <PaneNotice tone="warning">{t('activity.invalidTarget')}</PaneNotice> : null}
      {session.release.data !== undefined ? <ReleaseOutcome result={session.release.data} /> : null}
      {/* 开会话时 Manifest 有问题：会话照样开，但要把原因摆在这儿。轮询回来的会话对象不带它，所以取开会话那次的返回值。 */}
      {session.open.data?.message !== undefined ? <PaneNotice tone="warning">{session.open.data.message}</PaneNotice> : null}
      {session.session === undefined || !context.userId ? null : (
        <DevSessionWorkbench
          key={session.session.taskId}
          projectId={projectId}
          session={session.session}
          access={context.access}
          canDevelop={context.canDevelop}
          serviceId={context.serviceId}
          userId={context.userId}
          release={session.release}
          activityTarget={activityTarget}
          isAdmin={context.isAdmin} refresh={session.refresh} refreshing={session.refreshing}
          recovery={context.canDevelop && (session.session.state === 'failed' || session.session.connectionIssue || session.session.rebuild) ? <RebuildSessionControl projectId={projectId} session={session.session}
            newSession={<OpenSessionForm branches={branches} open={session.open} previousTaskId={session.session.taskId} />} /> : null}
        />
      )}
      {session.missing && context.canDevelop ? <OpenSessionForm branches={branches} open={session.open} /> : null}
      {session.missing && context.userId && !context.canDevelop ? <PaneNotice tone="info">{t('devSession.connection.noPermission')}</PaneNotice> : null}
    </>
  );
}
