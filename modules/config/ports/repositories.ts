import type { ConfigDefinitionDto, ConfigEnv, ProjectId } from '@crewstation/contracts';
import type { ConfigItem } from '../domain/configItem';
import type { ConfigVersion } from '../domain/configVersion';

export interface ConfigDefinitionRepository {
  list(projectId: ProjectId): Promise<ConfigDefinitionDto[]>;
  get(projectId: ProjectId, id: string): Promise<ConfigDefinitionDto | undefined>;
  insert(definition: ConfigDefinitionDto & { projectId: ProjectId }): Promise<void>;
  insertIfAbsent(definition: ConfigDefinitionDto & { projectId: ProjectId }): Promise<void>;
  rename(projectId: ProjectId, id: string, name: string): Promise<void>;
}

export interface ConfigItemRepository {
  list(projectId: ProjectId, env: ConfigEnv): Promise<ConfigItem[]>;
  get(projectId: ProjectId, env: ConfigEnv, id: string): Promise<ConfigItem | undefined>;
  upsert(item: ConfigItem): Promise<void>;
  remove(projectId: ProjectId, env: ConfigEnv, id: string): Promise<void>;
}

export interface ConfigVersionRepository {
  /** 原子地把 (projectId, env) 的版本号加一并返回新值；调用方在同一事务内用它写项与快照。 */
  next(projectId: ProjectId, env: ConfigEnv, now: Date): Promise<number>;
  /** 从未改动过的取值组为 0。 */
  current(projectId: ProjectId, env: ConfigEnv): Promise<number>;
  insert(snapshot: ConfigVersion): Promise<void>;
  get(projectId: ProjectId, env: ConfigEnv, version: number): Promise<ConfigVersion | undefined>;
  list(projectId: ProjectId, env: ConfigEnv): Promise<ConfigVersion[]>;
}
