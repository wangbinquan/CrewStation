import type { SessionModuleApi } from './api/moduleApi';

/** 装配期注入：其他模块的能力以端口形式出现在这里，由应用提供实现。 */
export type SessionModuleDeps = Record<string, never>;

export interface SessionModule {
  readonly api: SessionModuleApi;
}

export function createSessionModule(_deps: SessionModuleDeps): SessionModule {
  return { api: { name: 'session' } };
}
