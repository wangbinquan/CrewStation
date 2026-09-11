import type { DataModuleApi } from './api/moduleApi';

/** 装配期注入：其他模块的能力以端口形式出现在这里，由应用提供实现。 */
export type DataModuleDeps = Record<string, never>;

export interface DataModule {
  readonly api: DataModuleApi;
}

export function createDataModule(_deps: DataModuleDeps): DataModule {
  return { api: { name: 'data' } };
}
