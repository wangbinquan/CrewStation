import type { TaskRuntimeModuleApi } from './api/moduleApi';

/** 装配期注入：其他模块的能力以端口形式出现在这里，由应用提供实现。 */
export type TaskRuntimeModuleDeps = Record<string, never>;

export interface TaskRuntimeModule {
  readonly api: TaskRuntimeModuleApi;
}

export function createTaskRuntimeModule(_deps: TaskRuntimeModuleDeps): TaskRuntimeModule {
  return { api: { name: 'task-runtime' } };
}
