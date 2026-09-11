import type { BusinessTaskModuleApi } from './api/moduleApi';

/** 装配期注入：其他模块的能力以端口形式出现在这里，由应用提供实现。 */
export type BusinessTaskModuleDeps = Record<string, never>;

export interface BusinessTaskModule {
  readonly api: BusinessTaskModuleApi;
}

export function createBusinessTaskModule(_deps: BusinessTaskModuleDeps): BusinessTaskModule {
  return { api: { name: 'business-task' } };
}
