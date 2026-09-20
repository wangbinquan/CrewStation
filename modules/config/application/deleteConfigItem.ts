import type { Actor, ConfigEnv, ProjectId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { conflict, notFound } from '@crewstation/kernel';
import { writeActionFor } from '../domain/configItem';
import { snapshotOf } from '../domain/configVersion';
import type { ConfigUseCaseDeps } from './dependencies';

/** 删除也是一次改动：版本号加一并留下不含该项的快照。 */
export function deleteConfigItemUseCase({ uow, authorizer, clock }: ConfigUseCaseDeps) {
  return async (actor: Actor, projectId: ProjectId, env: ConfigEnv, id: string, expectedVersion: number): Promise<void> => {
    await authorizer.authorize(actor, projectId, writeActionFor(env));
    const now = clock.now();
    await uow.run(async (scope) => {
      const version = await scope.versions.next(projectId, env, now);
      const item = await scope.items.get(projectId, env, id);
      if (!item) throw notFound('配置项', id);
      if (item.version !== expectedVersion) throw conflict('配置项已变更，请刷新后重试');
      await scope.items.remove(projectId, env, id);
      await scope.versions.insert(snapshotOf(projectId, env, version, await scope.items.list(projectId, env), actor.userId, now));
      await scope.events.publish(DomainTopic.configChanged, { occurredAt: now.toISOString(), projectId, env, version });
    });
  };
}
