import type { ConfigEnv, ProjectId, UserId } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';

/**
 * 服务配置项（G8）：键名来自 Manifest `env` 段，取值分开发与生产两组；
 * Secret 的 `value` 是 SecretCipher 的密文，任何读接口都不返回它。
 */
export interface ConfigItem {
  readonly id: string;
  readonly definitionId: string;
  readonly bindingName: string;
  readonly projectId: ProjectId;
  readonly env: ConfigEnv;
  readonly name: string;
  readonly isSecret: boolean;
  /** 普通配置为明文；Secret 为密文。 */
  readonly value: string;
  /** 最近一次改动该项时该取值组的版本号。 */
  readonly version: number;
  readonly updatedBy: UserId;
  readonly updatedAt: Date;
}

export const CONFIG_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/** 与 contracts 的 ConfigNameSchema 同形；用例层再校验一次，保护不经 HTTP 的内部调用。 */
export function assertConfigName(name: string): void {
  if (!CONFIG_NAME_PATTERN.test(name)) throw validation(`配置项名 ${name} 必须是大写蛇形`, { name });
}

export type ConfigWriteAction = 'manage-production-config' | 'manage-development-config';

/** 生产组由负责人维护，开发组开发者即可维护（Design §7.3 角色表）。 */
export function writeActionFor(env: ConfigEnv): ConfigWriteAction {
  return env === 'production' ? 'manage-production-config' : 'manage-development-config';
}

export function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}
