import type { Actor, ProjectId } from '@crewstation/contracts';
import { forbidden, precondition } from '@crewstation/kernel';

export function projectHosts(settings: { userDomain: string; serviceDomain: string }) {
  return { prodHost: (slug: string) => `${slug}.${settings.userDomain}`, previewHost: (slug: string) => `preview.${slug}.${settings.userDomain}`,
    serviceHost: (name: string) => `${name}.${settings.serviceDomain}`, platformApiHost: () => `api.${settings.serviceDomain}` };
}
interface RetryProject {
  authorize(actor: Actor, id: ProjectId, action: 'view'): Promise<string>;
  getProject(actor: Actor, id: ProjectId): Promise<{ state: string }>;
}
export function provisioningRetry(project: RetryProject) {
  return async (actor: Actor, id: ProjectId) => {
    const role = await project.authorize(actor, id, 'view');
    if (role !== 'owner' && role !== 'admin') throw forbidden('只有负责人或管理员可以重新开通项目');
    if ((await project.getProject(actor, id)).state !== 'failed') throw precondition('只有开通失败的项目可以重试');
  };
}
/** Use the original loader for startup and deletion admission; archived/missing services stay excluded. */
export async function provisioningProjects<T>(project: { listClusterProjects(): Promise<{ projectId: string }[]>; getProvisioningProject(id: ProjectId): Promise<T | undefined> }): Promise<T[]> {
  const directory = await project.listClusterProjects(), facts = await Promise.all(directory.map((p) => project.getProvisioningProject(p.projectId as ProjectId)));
  return facts.filter((f): f is Awaited<T> => f !== undefined);
}
