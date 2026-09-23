import type { ItemsPage, SetConfigItemInput } from '@crewstation/api-client';
import type { ConfigDefinitionDto, ConfigEnv, ConfigItemDto, ConfigVersionDto } from '@crewstation/contracts';
import type { QueryKey, UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { AUTO_REFRESH, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import type { ApiClientError } from '../../../shared/api/useApi';

/** 版本历史挂在配置键之下：写入后只失效 `queryKeys.config`，按前缀连版本列表一并刷新。 */
function versionsKey(projectId: string, env: ConfigEnv): QueryKey {
  return [...queryKeys.config(projectId, env), 'versions'];
}

export interface ConfigEnvState {
  readonly definitions: UseQueryResult<ItemsPage<ConfigDefinitionDto>, ApiClientError>;
  readonly items: UseQueryResult<ItemsPage<ConfigItemDto>, ApiClientError>;
  readonly versions: UseQueryResult<ItemsPage<ConfigVersionDto>, ApiClientError>;
  readonly save: UseMutationResult<ConfigItemDto, ApiClientError, SetConfigItemInput & { id?: string }>;
  /** 入参带上名字：删除成功后列表会重读、那一项已经不在，提示只能用这里记下的名字。 */
  readonly remove: UseMutationResult<void, ApiClientError, { id: string; version: number; name: string }>;
}

/**
 * 一组取值（development 或 production）的全部读写；取值与版本历史每 30 秒在原位重读，页面不提供刷新按钮（2026-09-23 裁定）。
 * 生产组由项目负责人维护，非负责人会拿到 403；这里不隐藏控件，把服务端的说明原样交给页面显示。
 */
export function useConfigEnv(projectId: string, env: ConfigEnv): ConfigEnvState {
  const invalidate: readonly QueryKey[] = [queryKeys.config(projectId, env), ['config-definitions', projectId]];
  return {
    definitions: useApiQuery(['config-definitions', projectId], () => api.config.definitions(projectId)),
    items: useApiQuery(queryKeys.config(projectId, env), () => api.config.list(projectId, env), AUTO_REFRESH),
    versions: useApiQuery(versionsKey(projectId, env), () => api.config.listVersions(projectId, env), AUTO_REFRESH),
    save: useApiMutation(({ id, ...input }: SetConfigItemInput & { id?: string }) => id ? api.config.update(projectId, env, id, input) : api.config.create(projectId, env, input), { invalidate }),
    remove: useApiMutation(({ id, version }: { id: string; version: number; name: string }) => api.config.delete(projectId, env, id, version), { invalidate }),
  };
}
