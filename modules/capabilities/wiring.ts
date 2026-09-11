import type { CapabilitiesModuleApi } from './api/moduleApi';

/** 装配期注入：其他模块的能力以端口形式出现在这里，由应用提供实现。 */
export type CapabilitiesModuleDeps = Record<string, never>;

export interface CapabilitiesModule {
  readonly api: CapabilitiesModuleApi;
}

export function createCapabilitiesModule(_deps: CapabilitiesModuleDeps): CapabilitiesModule {
  return { api: { name: 'capabilities' } };
}
