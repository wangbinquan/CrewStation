import type { DevSessionDto, ServiceId } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { sessionAccess } from '../model/sessionAccess';
import type { SessionAccess } from '../model/sessionAccess';

export interface ProjectContext {
  readonly access: SessionAccess;
  /** 申请数据绑定要服务 ID；项目开通链未完成时没有。 */
  readonly serviceId: ServiceId | undefined;
  readonly canDevelop: boolean;
}

/** 当前用户与项目：决定谁能释放会话、谁要带 force，以及数据绑定挂在哪个服务上。 */
export function useProjectContext(projectId: string, session: DevSessionDto | undefined): ProjectContext {
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const project = useApiQuery(queryKeys.project(projectId), () => api.projects.get(projectId));
  const membership = me.data?.memberships.find((item) => item.projectId === projectId);
  const canDevelop = me.data !== undefined && (me.data.isAdmin || project.data?.ownerUserId === me.data.id || membership?.role === 'owner' || membership?.role === 'developer');
  return { access: sessionAccess(me.data, project.data, session), serviceId: project.data?.serviceId, canDevelop };
}
