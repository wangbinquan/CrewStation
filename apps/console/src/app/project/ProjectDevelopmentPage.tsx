import type { ReactElement } from 'react';
import { DevSessionPage } from '../../features/dev-session';
import { LogTail } from '../../features/logs';
import { useProjectScope } from '../../shared/project/ProjectScope';
import { ReferencePanel } from './ReferencePanel';

/** 开发页由 app 装配：dev-session feature 的工作区，加上跨 feature 的参考面板与内嵌日志（RFC-020 §4.3）。 */
export function ProjectDevelopmentPage(): ReactElement {
  const { projectId } = useProjectScope();
  return <DevSessionPage reference={<ReferencePanel />} sessionLogs={(taskId) => <LogTail projectId={projectId} taskId={taskId} />} />;
}
