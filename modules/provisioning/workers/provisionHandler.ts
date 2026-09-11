import type { ProjectId } from '@crewstation/contracts';
import type { JobHandler } from '@crewstation/queue';
import type { ProvisioningModuleApi } from '../api/moduleApi';

export const PROVISION_JOB_KIND = 'project.provision';

export function provisionJobHandler(api: Pick<ProvisioningModuleApi, 'provisionProject'>): JobHandler {
  return async (job) => {
    const { projectId } = job.payload as { projectId: ProjectId };
    const result = await api.provisionProject(projectId);
    if (result === 'failed') throw new Error(`项目 ${projectId} 开通失败，等待重试`);
  };
}
