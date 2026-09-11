import type { HttpMethod, OpenPolicy } from '@crewstation/contracts';
import { operationKey } from '@crewstation/contracts';

/** 代理与操作共用的目录条目状态：发布不再声明的条目标记 removed，不物理删除，Grant 与申请记录得以保留。 */
export type CatalogEntryState = 'active' | 'removed';

/** 目录中的一个操作：键 `<proxy>:<METHOD>:<path>` 是网关放行表、Grant 与申请共同使用的名字。 */
export interface ApiOperation {
  readonly key: string;
  readonly proxy: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly summary?: string;
  /** 默认 targeted：业务申请、管理员审批后才可调（Design §8）。 */
  readonly openPolicy: OpenPolicy;
  /** 资源语义说明，仅供业务与审批参考；平台不按它做资源级授权。 */
  readonly resourceNote?: string;
  readonly state: CatalogEntryState;
  readonly updatedAt: Date;
}

/** 从 OpenAPI 文档发现、尚未与目录对齐的操作。 */
export interface DiscoveredOperation {
  readonly method: HttpMethod;
  readonly path: string;
  readonly summary?: string;
  readonly resourceNote?: string;
}

/**
 * 新发布声明的操作集与目录现状对齐：新操作默认 targeted，已有操作保留管理员设定的开放策略，
 * 不再声明的活动操作标记 removed（Grant 保留但不再匹配，恢复声明后自动重新匹配）。
 */
export function reconcileOperations(existing: readonly ApiOperation[], discovered: readonly DiscoveredOperation[], proxy: string, now: Date): ApiOperation[] {
  const byKey = new Map(existing.map((op) => [op.key, op] as const));
  const seen = new Set<string>();
  const result: ApiOperation[] = [];
  for (const d of discovered) {
    const key = operationKey(proxy, d.method, d.path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      key, proxy, method: d.method, path: d.path,
      ...(d.summary === undefined ? {} : { summary: d.summary }),
      ...(d.resourceNote === undefined ? {} : { resourceNote: d.resourceNote }),
      openPolicy: byKey.get(key)?.openPolicy ?? 'targeted',
      state: 'active',
      updatedAt: now,
    });
  }
  for (const op of existing) {
    if (op.state === 'active' && !seen.has(op.key)) result.push({ ...op, state: 'removed', updatedAt: now });
  }
  return result;
}

/** 某服务是否可调：操作在目录中活动，且默认开放或该服务持有有效 Grant。 */
export function isCallable(op: ApiOperation, grantedKeys: ReadonlySet<string>): boolean {
  return op.state === 'active' && (op.openPolicy === 'default' || grantedKeys.has(op.key));
}
