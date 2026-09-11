import type { ApiCatalogModuleApi } from './api/moduleApi';

/** 装配期注入：其他模块的能力以端口形式出现在这里，由应用提供实现。 */
export type ApiCatalogModuleDeps = Record<string, never>;

export interface ApiCatalogModule {
  readonly api: ApiCatalogModuleApi;
}

export function createApiCatalogModule(_deps: ApiCatalogModuleDeps): ApiCatalogModule {
  return { api: { name: 'api-catalog' } };
}
