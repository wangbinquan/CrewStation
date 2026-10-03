import type { ProjectId } from '@crewstation/contracts';
import { ProjectIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { ExternalSteps, ProjectFacts, ProvisioningSteps } from '../api/steps';
import type { ProvisioningProjectWork } from '../ports/projectWork';

/** The enclosing original callback owns every await; each step rechecks it before and after IO. */
export function projectWorkSteps(work: ProvisioningProjectWork | undefined, source: ExternalSteps, namespace: (facts: ProjectFacts) => Promise<void>): ProvisioningSteps {
  const checked = async (id: ProjectId, effect: () => Promise<void>) => { await work?.checkCurrent(id); await effect(); await work?.checkCurrent(id); };
  return { ...source,
    ensureNamespace: (facts) => checked(facts.projectId, () => namespace(facts)),
    ensureRepository: (facts) => checked(facts.projectId, () => source.ensureRepository(facts)),
    ensureData: (facts) => checked(facts.projectId, () => source.ensureData(facts)),
    reconcileRoutes: (facts) => checked(facts.projectId, () => source.reconcileRoutes(facts)),
    ensureFirstRelease: (facts) => checked(facts.projectId, () => source.ensureFirstRelease(facts)),
    setProjectState: (id, state, message) => checked(id, () => source.setProjectState(id, state, message)),
  };
}
export function provisionWithOriginalWork(work: ProvisioningProjectWork | undefined, steps: ExternalSteps,
  provision: (id: ProjectId) => Promise<'active' | 'failed' | 'skipped'>) {
  return async (id: ProjectId): Promise<'active' | 'failed' | 'skipped'> => {
    if (!work) return provision(id);
    const facts = await steps.loadProject(id);
    if (!facts || facts.state === 'archived' || facts.state === 'deleting') return 'skipped';
    return work.run(id, facts.serviceId, 'provision', jsonHash(facts), () => provision(id));
  };
}
export function namespaceWithOriginalWork(work: ProvisioningProjectWork | undefined, declare: (facts: ProjectFacts) => Promise<void>) {
  return (facts: ProjectFacts): Promise<void> => work ? work.run(facts.projectId, facts.serviceId, 'namespace-reapply', jsonHash(facts), () => declare(facts)) : declare(facts);
}
export function enqueueWithOriginalWork(work: ProvisioningProjectWork | undefined, steps: ExternalSteps, enqueue: (id: string) => Promise<void>) {
  return async (raw: string, ignoreMissing = false) => {
    if (!work) return enqueue(raw);
    const id = ProjectIdSchema.parse(raw), facts = await steps.loadProject(id);
    if (!facts || facts.state === 'archived' || facts.state === 'deleting') {
      if (ignoreMissing) return;
      throw precondition('项目不再接受开通重试');
    }
    await work.run(id, facts.serviceId, 'enqueue', jsonHash({ projectId: id, kind: 'project.provision' }), async () => {
      await work.checkCurrent(id); await enqueue(id); await work.checkCurrent(id);
    });
  };
}
