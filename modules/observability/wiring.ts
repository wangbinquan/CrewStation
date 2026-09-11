import type { ObservabilityModuleApi } from './api/moduleApi';

/** 装配期注入：其他模块的能力以端口形式出现在这里，由应用提供实现。 */
export type ObservabilityModuleDeps = Record<string, never>;

export interface ObservabilityModule {
  readonly api: ObservabilityModuleApi;
}

export function createObservabilityModule(_deps: ObservabilityModuleDeps): ObservabilityModule {
  return { api: { name: 'observability' } };
}
