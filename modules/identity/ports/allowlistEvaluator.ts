import type { WorkloadIdentity } from '@crewstation/contracts';

export interface AllowlistTarget {
  host: string;
  method: string;
  /** 不含查询串的路径。 */
  path: string;
}

export interface AllowlistVerdict {
  allowed: boolean;
  reason?: string;
  /** 目标服务身份 `<project>/<service>`，或平台 API 的固定值 `platform-api`；决定来源令牌的 aud。 */
  targetIdentity: string;
  /** 目标正式版本维护中（RFC-021）：回 503 而不是 403。 */
  unavailable?: { message: string; retryAfterSeconds?: number };
}

/** 服务域放行表评估（Design §8.3）；由 gateway 模块经装配提供。 */
export interface AllowlistEvaluator {
  evaluate(caller: WorkloadIdentity, target: AllowlistTarget): Promise<AllowlistVerdict>;
}
