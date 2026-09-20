import type { ConfigDefinitionDto, ConfigEnv, ConfigItemDto, ConfigVersionDto } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import type { SetConfigItemInput } from '../requestInputs';
import { segment } from '../requestUrl';

/** 配置与 Secret：development／production 两组值；Secret 只写不读。 */
export interface ConfigResource {
  /** GET /v1/projects/:projectId/config/:env（Secret 不带 value） */
  list(projectId: string, env: ConfigEnv): Promise<ItemsPage<ConfigItemDto>>;
  /** POST /v1/projects/:projectId/config/:env：创建新项；请求体 env 由客户端按路径补齐。 */
  create(projectId: string, env: ConfigEnv, input: SetConfigItemInput): Promise<ConfigItemDto>;
  /** PUT /v1/projects/:projectId/config/:env/:id：按 UUID 与版本更新。 */
  update(projectId: string, env: ConfigEnv, id: string, input: SetConfigItemInput): Promise<ConfigItemDto>;
  definitions(projectId: string): Promise<ItemsPage<ConfigDefinitionDto>>;
  delete(projectId: string, env: ConfigEnv, id: string, expectedVersion: number): Promise<void>;
  /** GET /v1/projects/:projectId/config/:env/versions */
  listVersions(projectId: string, env: ConfigEnv): Promise<ItemsPage<ConfigVersionDto>>;
}

export function configResource(transport: Transport): ConfigResource {
  const base = (projectId: string, env: ConfigEnv) => `/v1/projects/${segment(projectId)}/config/${env}`;
  return {
    list: (projectId, env) => transport.request<ItemsPage<ConfigItemDto>>('GET', base(projectId, env)),
    create: (projectId, env, input) => transport.request<ConfigItemDto>('POST', base(projectId, env), { body: { ...input, env } }),
    update: (projectId, env, id, input) => transport.request<ConfigItemDto>('PUT', `${base(projectId, env)}/${segment(id)}`, { body: { ...input, env } }),
    definitions: (projectId) => transport.request<ItemsPage<ConfigDefinitionDto>>('GET', `/v1/projects/${segment(projectId)}/config-definitions`),
    delete: (projectId, env, id, expectedVersion) => transport.request<void>('DELETE', `${base(projectId, env)}/${segment(id)}`, { query: { expectedVersion } }),
    listVersions: (projectId, env) => transport.request<ItemsPage<ConfigVersionDto>>('GET', `${base(projectId, env)}/versions`),
  };
}
