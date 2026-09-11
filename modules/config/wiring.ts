import type { ConfigModuleApi } from './api/moduleApi';

/** 装配期注入：其他模块的能力以端口形式出现在这里，由应用提供实现。 */
export type ConfigModuleDeps = Record<string, never>;

export interface ConfigModule {
  readonly api: ConfigModuleApi;
}

export function createConfigModule(_deps: ConfigModuleDeps): ConfigModule {
  return { api: { name: 'config' } };
}
