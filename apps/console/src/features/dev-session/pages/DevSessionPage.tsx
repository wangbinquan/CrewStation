import type { ReactElement, ReactNode } from 'react';
import { useSearch } from '@tanstack/react-router';
import { activityTargetFromSearch } from '../../../shared/activity/agentActivityView';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { errorMessage, retryableReadError } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { OpenSessionForm } from '../components/OpenSessionForm';
import { PaneNotice } from '../components/PaneNotice';
import { ReleaseOutcome } from '../components/ReleaseOutcome';
import { RebuildSessionControl } from '../components/RebuildSessionControl';
import { NoSessionWorkspace } from '../components/panel/NoSessionWorkspace';
import { useBranches } from '../hooks/useBranches';
import { useDevSession } from '../hooks/useDevSession';
import { useProjectContext } from '../hooks/useProjectContext';
import { DevSessionWorkbench } from './DevSessionWorkbench';

export interface DevSessionPageProps {
  /** 参考面板（原开发资源三主题）由 app 装配；没有会话时也可打开。 */
  readonly reference?: ReactNode;
  /** 会话面板里的最近日志，由 app 装配。 */
  readonly sessionLogs?: (taskId: string) => ReactNode;
}

/**
 * 开发会话：一个项目同时最多一个长期运行的开发容器。
 * 没有会话时只给开会话的入口（旁边可打开参考面板）；有会话时整页是工作区，各面板共用一条任务流。
 */
export function DevSessionPage({ reference, sessionLogs }: DevSessionPageProps = {}): ReactElement {
  const t = useT();
  const { projectId } = useProjectScope();
  const search = useSearch({ strict: false });
  const activityTarget = activityTargetFromSearch(projectId, search);
  const session = useDevSession(projectId);
  const branches = useBranches(projectId);
  const context = useProjectContext(projectId, session.session);
  const noSession = <>{context.canDevelop ? <OpenSessionForm branches={branches} open={session.open} /> : null}{context.userId && !context.canDevelop ? <PaneNotice tone="info">{t('devSession.connection.noPermission')}</PaneNotice> : null}</>;
  // 会话未知（404 或读取失败）时参考面板照常可用：目录、事件与平台接入不依赖会话；开会话表单只在确认没有会话时出现。
  const settled = !session.isPending && session.session === undefined;
  return (
    <>
      {!session.session ? <PageHeader title={t('devSession.title')} description={[t('devSession.line1'), t('devSession.line2')]} /> : null}
      {session.isPending ? <PaneNotice tone="muted">{t('devSession.loading')}</PaneNotice> : null}
      {session.loadError !== null ? <PaneNotice tone="warning">{errorMessage(session.loadError)}{retryableReadError(session.loadError) ? ` ${t('ui.status.autoRetry')}` : ''}</PaneNotice> : null}
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
          isAdmin={context.isAdmin}
          reference={reference} sessionLogs={sessionLogs}
          {...(context.canDevelop ? { onRestart: () => session.open.mutate({ branch: session.session!.branch, restartOf: session.session!.taskId }) } : {})}
          recovery={context.canDevelop && (session.session.state === 'failed' || session.session.connectionIssue || session.session.rebuild) ? <RebuildSessionControl projectId={projectId} session={session.session}
            newSession={<OpenSessionForm branches={branches} open={session.open} previousTaskId={session.session.taskId} />} /> : null}
        />
      )}
      {/* 没有会话：主区是开会话表单（无开发权限时是说明），旁边随时可打开参考面板——目录与事件对项目成员都可读。 */}
      {settled ? (reference !== undefined ? <NoSessionWorkspace form={session.missing ? noSession : null} reference={reference} /> : session.missing ? noSession : null) : null}
    </>
  );
}
