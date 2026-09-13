import type { Actor } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';
import type { TemplateSource } from '../ports/templateSource';

export function listTemplatesUseCase(templates: TemplateSource) {
  return async (actor: Actor) => {
    if (!actor.isAdmin) throw forbidden('只有管理员可以查看项目创建模板');
    return templates.list();
  };
}
