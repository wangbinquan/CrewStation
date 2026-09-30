import { AcceptProjectDeletionSchema, ProjectDeletionOperationSchema, ProjectDeletionPlanSchema } from '@crewstation/contracts';
import type { AcceptProjectDeletion, ProjectDeletionOperation, ProjectDeletionPlan } from '@crewstation/contracts';
import type { Transport } from '../../httpTransport';
import { segment } from '../../requestUrl';

export interface ProjectDeletionsResource {
  prepare(projectId: string): Promise<ProjectDeletionPlan>;
  accept(projectId: string, input: AcceptProjectDeletion): Promise<ProjectDeletionOperation>;
  get(operationId: string): Promise<ProjectDeletionOperation>;
  retry(operationId: string): Promise<ProjectDeletionOperation>;
}
export function projectDeletionsResource(transport: Transport): ProjectDeletionsResource {
  const project = (id: string) => `/v1/projects/${segment(id)}`, operation = (id: string) => `/v1/project-deletions/${segment(id)}`;
  return {
    prepare: async (id) => ProjectDeletionPlanSchema.parse(await transport.request('POST', `${project(id)}/deletion-plans`, { body: {} })),
    accept: async (id, input) => ProjectDeletionOperationSchema.parse(await transport.request('POST', `${project(id)}/deletions`, { body: AcceptProjectDeletionSchema.parse(input) })),
    get: async (id) => ProjectDeletionOperationSchema.parse(await transport.request('GET', operation(id))),
    retry: async (id) => ProjectDeletionOperationSchema.parse(await transport.request('POST', `${operation(id)}/retry`, { body: {} })),
  };
}
