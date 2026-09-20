import type { ConfigDefinitionDto, ProjectId } from '@crewstation/contracts';
import { ConfigDefinitionDtoSchema } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';
import { assertConfigName } from '../domain/configItem';
import type { ConfigUseCaseDeps } from './dependencies';

/** Trusted provisioning port. It declares a binding; it never creates or changes a secret/value. */
export function ensureTemplateDefinitionUseCase({ uow }: ConfigUseCaseDeps) {
  return async (projectId: ProjectId, input: ConfigDefinitionDto): Promise<void> => {
    const definition = ConfigDefinitionDtoSchema.parse(input);
    assertConfigName(definition.bindingName);
    const check = (existing: ConfigDefinitionDto) => {
      if (existing.bindingName !== definition.bindingName) throw conflict('模板配置身份已绑定到另一个变量');
    };
    await uow.run(async (scope) => {
      await scope.definitions.insertIfAbsent({ ...definition, projectId });
      const winner = await scope.definitions.get(projectId, definition.id);
      if (!winner) throw conflict('模板配置变量已由另一个身份声明');
      check(winner);
    });
  };
}
