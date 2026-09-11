import type { GatewayModuleApi } from './api/moduleApi';

/** 装配期注入：其他模块的能力以端口形式出现在这里，由应用提供实现。 */
export type GatewayModuleDeps = Record<string, never>;

export interface GatewayModule {
  readonly api: GatewayModuleApi;
}

export function createGatewayModule(_deps: GatewayModuleDeps): GatewayModule {
  return { api: { name: 'gateway' } };
}
