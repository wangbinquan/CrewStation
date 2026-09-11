import type { Actor, ConfigEnv, ConfigItemDto, ConfigVersionDto, ProjectId } from '@crewstation/contracts';
import type { ConfigUseCaseDeps } from './dependencies';
import { itemToDto, versionToDto } from './toDto';

export function queryConfigUseCases({ uow, authorizer }: ConfigUseCaseDeps) {
  return {
    /** 项目成员可见键与普通配置的值；Secret 永远只见名字。 */
    listItems: async (actor: Actor, projectId: ProjectId, env: ConfigEnv): Promise<ConfigItemDto[]> => {
      await authorizer.authorize(actor, projectId, 'view');
      return (await uow.read.items.list(projectId, env)).map(itemToDto);
    },
    listVersions: async (actor: Actor, projectId: ProjectId, env: ConfigEnv): Promise<ConfigVersionDto[]> => {
      await authorizer.authorize(actor, projectId, 'view');
      return (await uow.read.versions.list(projectId, env)).map(versionToDto);
    },
    /** 供 release 固定 config_version；不经 actor。 */
    currentVersion: (projectId: ProjectId, env: ConfigEnv): Promise<number> => uow.read.versions.current(projectId, env),
  };
}
