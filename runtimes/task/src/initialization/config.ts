import { readFileSync } from 'node:fs';
import { RuntimeInitializationMaterialSchema } from '@crewstation/contracts';
import type { RuntimeInitializationConfig } from './runtimeInitialization';
import { RunnerCommandError } from '../commandError';

/** PID 1 在容器进程重启时变化、Runner 子进程重启时不变；Pod UID 区分容器所属实例。 */
export function runtimeContainerIdentity(podUid: string, stat: string): string {
  const suffix = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
  const ticks = suffix[19]; // /proc/<pid>/stat 的 starttime 是第 22 字段，suffix 从第 3 字段起。
  if (!/^[a-f0-9-]{36}$/.test(podUid) || !ticks || !/^\d+$/.test(ticks)) throw new RunnerCommandError('initialization_identity_missing', '运行环境缺少可信容器身份');
  return `${podUid}/${ticks}`;
}
export function loadRuntimeInitialization(env: Record<string, string | undefined>): RuntimeInitializationConfig | undefined {
  if (!env.CS_RUNTIME_IMAGE_INITIALIZATION) return undefined;
  return {
    material: RuntimeInitializationMaterialSchema.parse(JSON.parse(env.CS_RUNTIME_IMAGE_INITIALIZATION)),
    containerIdentity: runtimeContainerIdentity(env.CS_RUNTIME_POD_UID ?? '', readFileSync('/proc/1/stat', 'utf8')),
    journalDir: '/run/crewstation/runtime-initialization/private',
  };
}
