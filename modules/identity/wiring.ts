import type { IdentityModuleApi } from './api/moduleApi';

/** 装配期注入：其他模块的能力以端口形式出现在这里，由应用提供实现。 */
export type IdentityModuleDeps = Record<string, never>;

export interface IdentityModule {
  readonly api: IdentityModuleApi;
}

export function createIdentityModule(_deps: IdentityModuleDeps): IdentityModule {
  return { api: { name: 'identity' } };
}
