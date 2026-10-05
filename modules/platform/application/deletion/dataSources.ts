import { ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { InfrastructureSourceModules, OriginalInfrastructureOrigin } from '../../ports/infrastructureOrigins';

/** Data joins public original owner witnesses; resources are never reassigned by current slug. */
export function dataDeletionSources(project: InfrastructureSourceModules['project'] & { assertProjectDeletionGrant(context: ProjectDeletionContext): Promise<void> },
  modules: () => Pick<InfrastructureSourceModules, 'taskRuntime' | 'businessTask'>) {
  const resolve = async (kind: 'project' | 'service' | 'task', key: string) => {
    const representation = ResourceIdSchema.safeParse(key).success ? 'current' as const : 'legacy' as const;
    let facts: readonly (OriginalInfrastructureOrigin | undefined)[];
    if (kind === 'task') {
      const source = modules();
      facts = await Promise.all([source.taskRuntime.originalInfrastructureOwnership(kind,key,representation),source.businessTask.originalInfrastructureOwnership(kind,key,representation)]);
    } else facts = [await project.originalInfrastructureOwnership(kind,key,representation)];
    const found = facts.filter((f): f is OriginalInfrastructureOrigin => f !== undefined);
    if (!found.length) return undefined;
    const first = found[0]!;
    if (!first.complete || first.scope !== 'project' || first.projectIds.length !== 1 || found.some(f => !f.complete || f.id !== first.id || f.scope !== 'project' || f.projectIds.length !== 1 || f.projectIds[0] !== first.projectIds[0])) throw precondition('data original owner witnesses disagree');
    return { complete: true as const, id: ResourceIdSchema.parse(first.id), projectId: ProjectIdSchema.parse(first.projectIds[0]) };
  };
  return { resolve, assertGrant: project.assertProjectDeletionGrant, reference: (type: string, id: string) => type === 'task' ? resolve('task',id) : type === 'application' ? resolve('service',id) : Promise.resolve(undefined) };
}
