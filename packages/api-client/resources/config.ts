import type { ConfigEnv, ConfigItemDto, ConfigVersionDto } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import type { SetConfigItemInput } from '../requestInputs';
import { segment } from '../requestUrl';

/** 配置与 Secret：development／production 两组值；Secret 只写不读。 */
export interface ConfigResource {
  /** GET /v1/projects/:projectId/config/:env（Secret 不带 value） */
  list(projectId: string, env: ConfigEnv): Promise<ItemsPage<ConfigItemDto>>;
  /** PUT /v1/projects/:projectId/config/:env：新增或覆盖一项；请求体 env 由客户端按路径补齐。 */
  set(projectId: string, env: ConfigEnv, input: SetConfigItemInput): Promise<ConfigItemDto>;
  /** DELETE /v1/projects/:projectId/config/:env/:name（204） */
  delete(projectId: string, env: ConfigEnv, name: string): Promise<void>;
  /** GET /v1/projects/:projectId/config/:env/versions */
  listVersions(projectId: string, env: ConfigEnv): Promise<ItemsPage<ConfigVersionDto>>;
}

export function configResource(transport: Transport): ConfigResource {
  const base = (projectId: string, env: ConfigEnv) => `/v1/projects/${segment(projectId)}/config/${env}`;
  return {
    list: (projectId, env) => transport.request<ItemsPage<ConfigItemDto>>('GET', base(projectId, env)),
    set: (projectId, env, input) => transport.request<ConfigItemDto>('PUT', base(projectId, env), { body: { ...input, env } }),
    delete: (projectId, env, name) => transport.request<void>('DELETE', `${base(projectId, env)}/${segment(name)}`),
    listVersions: (projectId, env) => transport.request<ItemsPage<ConfigVersionDto>>('GET', `${base(projectId, env)}/versions`),
  };
}
