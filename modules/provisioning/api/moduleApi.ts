import type { ProjectId } from '@crewstation/contracts';

export interface ProvisioningModuleApi {
  readonly name: 'provisioning';
  /** 同步执行一次开通链（CLI 与测试用）；正常路径由 project.created 事件入队。 */
  provisionProject(projectId: ProjectId): Promise<'active' | 'failed' | 'skipped'>;
  /** 重新开通失败的项目。 */
  retry(projectId: ProjectId): Promise<void>;
}
