import { AcceptProjectDeletionSchema, ProjectDeletionCapabilitiesSchema, ProjectDeletionLookupSchema, ProjectDeletionOperationSchema, ProjectDeletionPlanSchema } from '@crewstation/contracts';
import type { AcceptProjectDeletion, ProjectDeletionCapabilities, ProjectDeletionOperation, ProjectDeletionPlan } from '@crewstation/contracts';
import type { Transport } from '../../httpTransport';
import { segment } from '../../requestUrl';

export interface ProjectDeletionsResource {
  capabilities(): Promise<ProjectDeletionCapabilities>;
  prepare(projectId: string): Promise<ProjectDeletionPlan>;
  accept(projectId: string, input: AcceptProjectDeletion): Promise<ProjectDeletionOperation>;
  get(operationId: string): Promise<ProjectDeletionOperation>;
  find(projectId: string): Promise<ProjectDeletionOperation | undefined>;
  retry(operationId: string): Promise<ProjectDeletionOperation>;
  prepareReconfirmation(operationId: string): Promise<ProjectDeletionPlan>;
  reconfirm(operationId: string, input: AcceptProjectDeletion): Promise<ProjectDeletionOperation>;
}
export function projectDeletionsResource(transport: Transport): ProjectDeletionsResource {
  const project = (id: string) => `/v1/projects/${segment(id)}`, operation = (id: string) => `/v1/project-deletions/${segment(id)}`;
  return {
    capabilities: async () => ProjectDeletionCapabilitiesSchema.parse(await transport.request('GET', '/v1/project-deletions/capabilities')),
    prepare: async (id) => ProjectDeletionPlanSchema.parse(await transport.request('POST', `${project(id)}/deletion-plans`, { body: {} })),
    accept: async (id, input) => ProjectDeletionOperationSchema.parse(await transport.request('POST', `${project(id)}/deletions`, { body: AcceptProjectDeletionSchema.parse(input) })),
    get: async (id) => ProjectDeletionOperationSchema.parse(await transport.request('GET', operation(id))),
    find: async (id) => {
      const result = ProjectDeletionLookupSchema.parse(await transport.request('GET', `${project(id)}/deletion-operation`));
      if (result.projectId !== id) throw new TypeError('删除查询结果未绑定请求的原项目'); return result.operation ?? undefined;
    },
    retry: async (id) => ProjectDeletionOperationSchema.parse(await transport.request('POST', `${operation(id)}/retry`, { body: {} })),
    prepareReconfirmation: async (id) => {
      const plan = ProjectDeletionPlanSchema.parse(await transport.request('POST', `${operation(id)}/reconfirmation-plans`, { body: {} }));
      if (plan.operationId !== id) throw new TypeError('重新确认计划未绑定请求的原删除操作'); return plan;
    },
    reconfirm: async (id, input) => ProjectDeletionOperationSchema.parse(await transport.request('POST', `${operation(id)}/reconfirm`, { body: AcceptProjectDeletionSchema.parse(input) })),
  };
}
