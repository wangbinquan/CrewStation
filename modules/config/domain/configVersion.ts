import type { ConfigEnv, EnvEntry, ProjectId, UserId } from '@crewstation/contracts';
import type { ConfigItem } from './configItem';
import { byName } from './configItem';

export interface ConfigVersionEntry {
  readonly itemId: string;
  readonly definitionId: string;
  readonly bindingName: string;
  readonly name: string;
  readonly isSecret: boolean;
  /** 与 ConfigItem.value 同义：Secret 存密文，Release 可据此重建注入内容。 */
  readonly value: string;
}

/** 某取值组在某版本的完整快照；每次改动生成一个，供 Release 固定 config_version 与回放。 */
export interface ConfigVersion {
  readonly projectId: ProjectId;
  readonly env: ConfigEnv;
  readonly version: number;
  readonly entries: readonly ConfigVersionEntry[];
  readonly createdBy: UserId;
  readonly createdAt: Date;
}

export function snapshotOf(projectId: ProjectId, env: ConfigEnv, version: number, items: readonly ConfigItem[], createdBy: UserId, createdAt: Date): ConfigVersion {
  const entries = [...items].sort(byName).map(({ id, definitionId, bindingName, name, isSecret, value }) => ({ itemId: id, definitionId, bindingName, name, isSecret, value }));
  return { projectId, env, version, entries, createdBy, createdAt };
}

export function keysOf(entries: readonly { name: string }[]): string[] {
  return [...entries].sort(byName).map((e) => e.name);
}

/** Manifest env 段引用的配置项键：缺省取环境变量名本身。 */
export function configKeyOf(entry: EnvEntry): string {
  return entry.configDefinitionId;
}

/** 取值组里不存在的键；Release 与开发会话启动前据此拒绝或提示。 */
export function missingKeys(entries: readonly EnvEntry[], present: readonly { definitionId: string }[]): string[] {
  const names = new Set(present.map((p) => p.definitionId));
  return [...new Set(entries.map(configKeyOf).filter((key) => !names.has(key)))];
}
