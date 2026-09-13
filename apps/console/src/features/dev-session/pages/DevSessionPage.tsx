import type { ReactElement } from 'react';
import { useSearch } from '@tanstack/react-router';
import { activityTargetFromSearch } from '../../../shared/activity/agentActivityView';
import { projectRoute } from '../../../app/router/projectRoute';
import { errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { OpenSessionForm } from '../components/OpenSessionForm';
import { PaneNotice } from '../components/PaneNotice';
import { ReleaseOutcome } from '../components/ReleaseOutcome';
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
  const { projectId } = projectRoute.useParams();
  const search = useSearch({ strict: false });
  const activityTarget = activityTargetFromSearch(projectId, search);
  const session = useDevSession(projectId);
  const branches = useBranches(projectId);
  const context = useProjectContext(projectId, session.session);
  return (
    <>
      {!session.session ? <PageHeader title={t('devSession.title')} description={[t('devSession.line1'), t('devSession.line2')]} /> : null}
      {session.isPending ? <PaneNotice tone="muted">{t('devSession.loading')}</PaneNotice> : null}
      {session.loadError !== null ? <PaneNotice tone="warning">{errorMessage(session.loadError)}</PaneNotice> : null}
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
        />
      )}
      {session.missing ? <OpenSessionForm branches={branches} open={session.open} /> : null}
    </>
  );
}
