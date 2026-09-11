import type {
  Actor, ConfigEnv, ConfigItemDto, ConfigVersionDto, EnvEntry, ManifestEnvValidation, ProjectId, SetConfigItemRequest,
} from '@crewstation/contracts';

/**
 * config 模块对外能力（G8）：配置与 Secret 是平台对象，键名来自 Manifest env 段，取值分开发与生产两组；
 * 生产组由负责人维护，开发组开发者可维护；Secret 只写不读；每次改动使 (project, env) 的版本号加一并发布 config.changed。
 */
export interface ConfigModuleApi {
  readonly name: 'config';
  setItem(actor: Actor, projectId: ProjectId, input: SetConfigItemRequest): Promise<ConfigItemDto>;
  deleteItem(actor: Actor, projectId: ProjectId, env: ConfigEnv, name: string): Promise<void>;
  /** 不含 Secret 的值。 */
  listItems(actor: Actor, projectId: ProjectId, env: ConfigEnv): Promise<ConfigItemDto[]>;
  listVersions(actor: Actor, projectId: ProjectId, env: ConfigEnv): Promise<ConfigVersionDto[]>;
  /** 解密后的环境变量键值；供 release／task-runtime 在受信路径注入，不经 actor，不经 HTTP。指定 version 时按快照回放。 */
  renderEnv(projectId: ProjectId, env: ConfigEnv, version?: number): Promise<Record<string, string>>;
  /** 从未改动过为 0。 */
  currentVersion(projectId: ProjectId, env: ConfigEnv): Promise<number>;
  /** Manifest env 段引用的键（key 缺省取 name）必须已存在于目标取值组。 */
  validateManifestEnv(projectId: ProjectId, env: ConfigEnv, entries: readonly EnvEntry[]): Promise<ManifestEnvValidation>;
}
