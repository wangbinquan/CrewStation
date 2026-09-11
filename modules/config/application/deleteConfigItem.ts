import type { Actor, ConfigEnv, ProjectId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import { writeActionFor } from '../domain/configItem';
import { snapshotOf } from '../domain/configVersion';
import type { ConfigUseCaseDeps } from './dependencies';

/** 删除也是一次改动：版本号加一并留下不含该项的快照。 */
export function deleteConfigItemUseCase({ uow, authorizer, clock }: ConfigUseCaseDeps) {
  return async (actor: Actor, projectId: ProjectId, env: ConfigEnv, name: string): Promise<void> => {
    await authorizer.authorize(actor, projectId, writeActionFor(env));
    const now = clock.now();
    await uow.run(async (scope) => {
      if (!(await scope.items.get(projectId, env, name))) throw notFound('配置项', name);
      const version = await scope.versions.next(projectId, env, now);
      await scope.items.remove(projectId, env, name);
      await scope.versions.insert(snapshotOf(projectId, env, version, await scope.items.list(projectId, env), actor.userId, now));
      await scope.events.publish(DomainTopic.configChanged, { occurredAt: now.toISOString(), projectId, env, version });
    });
  };
}
