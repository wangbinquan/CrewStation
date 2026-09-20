import type { AgentProtocol, ComputeProfileAvailability, ComputeProfileContent, UserId } from '@crewstation/contracts';
import type { ProfileTest } from './profileTest';
import { outcomeSentence } from './profileTest';

/**
 * 算力档位（RFC-006）：身份与开关在这里，执行内容在只追加的修订里。说明、启用与默认不进修订（P3）：
 * 改它们不会让测试作废，也不会产生新的执行快照。
 */
export interface ComputeProfile {
  readonly name: string;
  /** 建档后不可改（P1）；换协议就新建档位。 */
  readonly protocol: AgentProtocol;
  readonly description: string;
  readonly enabled: boolean;
  readonly isDefault: boolean;
  readonly defaultVisible?: boolean;
  readonly currentRevision: number;
  readonly createdBy: UserId;
  readonly createdAt: Date;
  readonly updatedBy: UserId;
  readonly updatedAt: Date;
}

/** 一个不可变修订：内容里的 image 是规范化后的平台仓库拉取引用，摘要单独固定。 */
export interface ProfileRevision {
  readonly profile: string;
  readonly revision: number;
  readonly content: ComputeProfileContent;
  readonly imageDigest: string;
  /** 内容＋摘要＋凭据戳的哈希；它变了就是新的执行配置，要重新测试。 */
  readonly contentHash: string;
  readonly createdBy: UserId;
  readonly createdAt: Date;
}

export interface ProfileCredential {
  readonly profile: string;
  readonly name: string;
  readonly cipherText: string;
  readonly updatedBy: UserId;
  readonly updatedAt: Date;
}

const sha256 = (text: string): string => new Bun.CryptoHasher('sha256').update(text).digest('hex');

/** 凭据戳：声明的凭据名及其当前密文（每次加密都换随机 IV），任何一次替换或清除都会改变它。 */
export function credentialStampOf(declared: readonly string[], credentials: readonly Pick<ProfileCredential, 'name' | 'cipherText'>[]): string {
  const entries = [...declared].sort().map((name) => [name, credentials.find((c) => c.name === name)?.cipherText ?? null]);
  return sha256(JSON.stringify(entries));
}

/** 规范化 JSON：对象键排序，数组保持顺序（步骤顺序本身就是内容）。 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}

export function contentHashOf(content: ComputeProfileContent, imageDigest: string, credentialStamp: string): string {
  return sha256(JSON.stringify({ content: canonical(content), imageDigest, credentialStamp }));
}

/** 租户能不能选：停用 > 当前修订的最近测试。测试记录必须对得上当前修订的内容哈希，否则视为尚未测试。 */
export function availabilityOf(profile: Pick<ComputeProfile, 'name' | 'enabled'>, revision: Pick<ProfileRevision, 'contentHash'>, latest: ProfileTest | undefined): ComputeProfileAvailability {
  if (!profile.enabled) return { state: 'disabled', available: false, reason: `档位 ${profile.name} 已停用，请联系管理员启用或改选其他档位` };
  if (!latest || latest.contentHash !== revision.contentHash || latest.state === 'superseded') return { state: 'untested', available: false, reason: `档位 ${profile.name} 还没有通过测试，请管理员在平台管理里测试` };
  if (latest.state === 'passed') return { state: 'ready', available: true };
  if (latest.state === 'queued' || latest.state === 'running') return { state: 'testing', available: false, reason: `档位 ${profile.name} 正在测试，通过后即可使用` };
  const why = latest.outcome ? outcomeSentence(latest.outcome) : (latest.error ?? '测试没有得到确定结果');
  return { state: 'test-failed', available: false, reason: `档位 ${profile.name} 测试未通过：${why}` };
}
