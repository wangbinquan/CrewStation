import type { EgressModuleApi } from './api/moduleApi';

/** 装配期注入：其他模块的能力以端口形式出现在这里，由应用提供实现。 */
export type EgressModuleDeps = Record<string, never>;

export interface EgressModule {
  readonly api: EgressModuleApi;
}

export function createEgressModule(_deps: EgressModuleDeps): EgressModule {
  return { api: { name: 'egress' } };
}
