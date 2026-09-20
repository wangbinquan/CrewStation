import type { Actor, ConfigItemDto, ProjectId, SetConfigItemRequest } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { conflict, newResourceId, notFound, validation } from '@crewstation/kernel';
import type { ConfigItem } from '../domain/configItem';
import { assertConfigName, writeActionFor } from '../domain/configItem';
import { snapshotOf } from '../domain/configVersion';
import type { ConfigUseCaseDeps } from './dependencies';
import { itemToDto } from './toDto';

/** Create never replaces by name. Updates address an item and compare its observed version. */
export function configItemWriteUseCases({ uow, cipher, authorizer, clock }: ConfigUseCaseDeps) {
  const write = async (actor: Actor, projectId: ProjectId, input: SetConfigItemRequest, id?: string): Promise<ConfigItemDto> => {
    assertConfigName(input.bindingName);
    await authorizer.authorize(actor, projectId, writeActionFor(input.env));
    const now = clock.now(), value = input.isSecret ? await cipher.encrypt(input.value) : input.value;
    return uow.run(async (scope) => {
      // The environment counter serializes reads, CAS, mutation and immutable snapshot creation.
      const version = await scope.versions.next(projectId, input.env, now);
      const previous = id ? await scope.items.get(projectId, input.env, id) : undefined;
      if (id && !previous) throw notFound('配置项', id);
      if (previous && previous.version !== input.expectedVersion) throw conflict('配置项已变更，请刷新后重试');
      if (previous && input.definitionId && previous.definitionId !== input.definitionId) throw validation('不能更改配置项所属定义');
      const definitionId = previous?.definitionId ?? input.definitionId;
      let definition = definitionId ? await scope.definitions.get(projectId, definitionId) : undefined;
      if (definitionId && !definition) throw notFound('配置定义', definitionId);
      if (definition && definition.bindingName !== input.bindingName) throw validation('变量绑定符号不可通过修改取值改变，请创建新的配置定义');
      if (!definition) {
        if ((await scope.definitions.list(projectId)).some((entry) => entry.bindingName === input.bindingName)) throw conflict('变量绑定已存在，请按配置定义 ID 创建环境取值');
        definition = { id: newResourceId(), name: input.name, bindingName: input.bindingName };
        await scope.definitions.insert({ ...definition, projectId });
      }
      if (!previous && (await scope.items.list(projectId, input.env)).some((entry) => entry.definitionId === definition.id)) throw conflict('此配置定义在该环境已有取值，请按配置项 ID 更新');
      if (definition.name !== input.name) await scope.definitions.rename(projectId, definition.id, input.name);
      const item: ConfigItem = { id: previous?.id ?? newResourceId(), definitionId: definition.id, bindingName: definition.bindingName,
        projectId, env: input.env, name: input.name, isSecret: input.isSecret, value, version, updatedBy: actor.userId, updatedAt: now };
      await scope.items.upsert(item);
      await scope.versions.insert(snapshotOf(projectId, input.env, version, await scope.items.list(projectId, input.env), actor.userId, now));
      await scope.events.publish(DomainTopic.configChanged, { occurredAt: now.toISOString(), projectId, env: input.env, version });
      return itemToDto(item);
    });
  };
  return {
    createItem: (actor: Actor, projectId: ProjectId, input: SetConfigItemRequest) => write(actor, projectId, input),
    updateItem: (actor: Actor, projectId: ProjectId, id: string, input: SetConfigItemRequest) => write(actor, projectId, input, id),
  };
}
