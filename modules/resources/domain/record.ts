import type { ClusterPurpose, ProjectId, ResourceChild, ResourceCondition, ResourceKind, ResourceOwner, ResourcePhase, ResourceReason, StartupRecord } from '@crewstation/contracts';

/** 列记录的条件（视图、推送流、调和器共用）。 */
export interface RecordFilter {
  readonly projectId?: ProjectId;
  readonly kind?: ResourceKind;
  readonly parentId?: string;
  /** 带上已结束的；缺省只要在运行、结束中与失败保留中的，外加稳定记录（服务槽，已结束也列）。 */
  readonly includeStopped?: boolean;
  readonly limit?: number;
}

/** 期望里的一个子对象：种类＋命名空间＋名字。调和器按它认领集群里的对象（RFC-025 设计 §6.2）。 */
export interface ExpectedChild {
  readonly kind: string;
  readonly namespace?: string;
  readonly name: string;
}

/** 期望：子对象清单是公共部分；按种类的其余字段由所属模块写、界面不解读。 */
export interface ResourceSpec {
  readonly children: readonly ExpectedChild[];
  readonly [field: string]: unknown;
}

/**
 * 台账里的一条记录。期望（desired、spec、generation、releaseReason）只由所属模块写；
 * 实况（conditions 里的观测部分、children、phase、reason、observedGeneration）只由资源中心写。
 */
export interface LedgerRecord {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly projectId?: ProjectId;
  readonly owner: ResourceOwner;
  readonly parentId?: string;
  readonly purpose?: ClusterPurpose;
  readonly desired: 'present' | 'absent';
  readonly spec: ResourceSpec;
  readonly generation: number;
  readonly observedGeneration: number;
  readonly releaseReason?: ResourceReason;
  readonly conditions: readonly ResourceCondition[];
  readonly children: readonly ResourceChild[];
  readonly startup?: StartupRecord;
  readonly display: Readonly<Record<string, string>>;
  readonly phase: ResourcePhase;
  readonly phaseSince: Date;
  readonly reason?: ResourceReason;
  readonly idleSince?: Date;
  readonly retainUntil?: Date;
  readonly aliases: readonly ResourceAlias[];
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** 已结束满 7 天后压缩的时刻（设计 §8.3）：压缩后只留身份、种类、最终阶段与原因、时间。 */
  readonly compactedAt?: Date;
}

/** 旧形状对象的别名（RFC-025 B11）：来源＋旧名字；记录本身只用 UUID。 */
export interface ResourceAlias {
  readonly source: 'rel' | 'tsk' | 'pvc-name' | 'route-name';
  readonly alias: string;
}

export const aliasText = (alias: ResourceAlias): string => `${alias.source}:${alias.alias}`;

/** 子对象的身份键：同一个集群对象只属于一条记录。 */
export function childKey(child: { readonly kind: string; readonly namespace?: string; readonly name: string }): string {
  return `${child.kind}/${child.namespace ?? ''}/${child.name}`;
}

/**
 * 比较两份子对象时用的规范顺序（按种类、命名空间、名字）：库里按种类与名字读回，合并按期望里的顺序排，
 * 直接按数组比就会把同样的内容判成变化、每次核对都重写一遍（2026-09-23 起开发工作区记录每秒被空写数次）。
 */
export function inKeyOrder<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => { const left = keyOf(a), right = keyOf(b); return left < right ? -1 : left > right ? 1 : 0; });
}

/** 还没观测到的子对象：phase 记为 absent。 */
export function unobservedChild(expected: ExpectedChild): ResourceChild {
  return { kind: expected.kind, ...(expected.namespace ? { namespace: expected.namespace } : {}), name: expected.name, phase: 'absent', ready: false };
}

export function isPresent(child: ResourceChild): boolean {
  return child.phase !== 'absent';
}

/**
 * 期望的子对象与已有观测合并：期望里的每一个都在（没观测到的记 absent）；
 * 期望里已经没有、但集群里还在的（例如重建换下的旧 Pod）保留，直到观测到它消失。
 */
export function mergeChildren(expected: readonly ExpectedChild[], observed: readonly ResourceChild[]): ResourceChild[] {
  const known = new Map(observed.map((child) => [childKey(child), child]));
  const wanted = expected.map((child) => known.get(childKey(child)) ?? unobservedChild(child));
  const wantedKeys = new Set(expected.map(childKey));
  const stale = observed.filter((child) => !wantedKeys.has(childKey(child)) && isPresent(child));
  return [...wanted, ...stale];
}

/** 期望里的子对象（界面与阶段只看它们；多出来的旧对象只影响「结束中」）。 */
export function expectedChildren(record: Pick<LedgerRecord, 'spec' | 'children'>): ResourceChild[] {
  const keys = new Set(record.spec.children.map(childKey));
  return record.children.filter((child) => keys.has(childKey(child)));
}
