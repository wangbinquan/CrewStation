import type { EventsModuleApi } from './api/moduleApi';

/** 装配期注入：其他模块的能力以端口形式出现在这里，由应用提供实现。 */
export type EventsModuleDeps = Record<string, never>;

export interface EventsModule {
  readonly api: EventsModuleApi;
}

export function createEventsModule(_deps: EventsModuleDeps): EventsModule {
  return { api: { name: 'events' } };
}
