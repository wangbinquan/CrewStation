import type { Actor, ConfigItemDto, ProjectId, SetConfigItemRequest } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import type { ConfigItem } from '../domain/configItem';
import { assertConfigName, writeActionFor } from '../domain/configItem';
import { snapshotOf } from '../domain/configVersion';
import type { ConfigUseCaseDeps } from './dependencies';
import { itemToDto } from './toDto';

/** 新增或覆盖一项：Secret 先加密再落库；同一事务内版本号加一、写快照、发 config.changed。 */
export function setConfigItemUseCase({ uow, cipher, authorizer, clock }: ConfigUseCaseDeps) {
  return async (actor: Actor, projectId: ProjectId, input: SetConfigItemRequest): Promise<ConfigItemDto> => {
    assertConfigName(input.name);
    await authorizer.authorize(actor, projectId, writeActionFor(input.env));
    const now = clock.now();
    const value = input.isSecret ? await cipher.encrypt(input.value) : input.value;
    return uow.run(async (scope) => {
      const version = await scope.versions.next(projectId, input.env, now);
      const item: ConfigItem = { projectId, env: input.env, name: input.name, isSecret: input.isSecret, value, version, updatedBy: actor.userId, updatedAt: now };
      await scope.items.upsert(item);
      await scope.versions.insert(snapshotOf(projectId, input.env, version, await scope.items.list(projectId, input.env), actor.userId, now));
      await scope.events.publish(DomainTopic.configChanged, { occurredAt: now.toISOString(), projectId, env: input.env, version });
      return itemToDto(item);
    });
  };
}
