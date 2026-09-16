import type { BeforeStartStep, ConfigFileBinding, RuntimeCheckState, RuntimeConfigId, RuntimeConfigStatus, RuntimeDriver, UserId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';

/** 运行环境（管理员维护）：元信息与两个版本指针；版本内容只追加，见 RuntimeRevision。 */
export interface RuntimeConfig {
  readonly id: RuntimeConfigId;
  readonly name: string;
  readonly description: string;
  /** 建档后固定；换 CLI 须新建配置，避免既有版本含义变化。 */
  readonly driver: RuntimeDriver;
  readonly draftRevision: number;
  readonly activeRevision: number | null;
  /** 停用只阻止新的托管启动；activeRevision 保留，便于回退时重新启用。 */
  readonly enabled: boolean;
  readonly createdBy: UserId;
  readonly createdAt: Date;
  readonly updatedBy: UserId;
  readonly updatedAt: Date;
}

/** 版本内容：文件、脚本、变量引用、凭据名、CLI 配置绑定与模型范围；contentHash 由 canonical JSON 求得。 */
export interface RuntimeRevisionContent {
  readonly steps: BeforeStartStep[];
  readonly vars: Record<string, string>;
  readonly secretNames: string[];
  readonly configFile: ConfigFileBinding;
  readonly defaultModel?: string;
  readonly models: string[];
}

export interface RuntimeRevision extends RuntimeRevisionContent {
  readonly configId: RuntimeConfigId;
  readonly revision: number;
  readonly contentHash: string;
  readonly createdBy: UserId;
  readonly createdAt: Date;
}

export interface RuntimeCredential {
  readonly configId: RuntimeConfigId;
  readonly name: string;
  readonly cipherText: string;
  readonly updatedBy: UserId;
  readonly updatedAt: Date;
}

/** 状态优先级：已停用 > 已启用 > 草稿检查结果。草稿与已启用版本不同时页面另行提示。 */
export function statusOf(config: RuntimeConfig, latestDraftCheck: { state: RuntimeCheckState } | undefined): RuntimeConfigStatus {
  if (!config.enabled) return 'disabled';
  if (config.activeRevision !== null) return 'active';
  if (latestDraftCheck?.state === 'succeeded') return 'checked';
  if (latestDraftCheck?.state === 'failed') return 'check-failed';
  return 'draft';
}

export function contentHashOf(content: RuntimeRevisionContent): string {
  const canonical = JSON.stringify({
    steps: content.steps, vars: sortedEntries(content.vars), secretNames: [...content.secretNames].sort(), configFile: content.configFile,
    defaultModel: content.defaultModel ?? null, models: [...content.models],
  });
  return new Bun.CryptoHasher('sha256').update(canonical).digest('hex');
}

function sortedEntries(record: Record<string, string>): Array<[string, string]> {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
}

/** 托管启动只能用已启用配置的已启用版本；解析失败要指向管理员可处理的原因，不转嫁给租户手工配置。 */
export function assertResolvable(config: RuntimeConfig): number {
  if (!config.enabled) throw precondition(`运行环境 ${config.name} 已停用，请管理员启用或改绑档位`, { code: 'runtime_config_disabled', configId: config.id });
  if (config.activeRevision === null) throw precondition(`运行环境 ${config.name} 尚未启用任何版本，请管理员完成检查并启用`, { code: 'runtime_config_inactive', configId: config.id });
  return config.activeRevision;
}
