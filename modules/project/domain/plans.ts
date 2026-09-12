import type { AgentDriver } from '@crewstation/contracts';

/** 管理员定义的套餐；Manifest 只按名字引用（G24）。 */
export interface ServicePlan {
  readonly name: string;
  readonly cpu: string;
  readonly memory: string;
  readonly maxReplicas: number;
  readonly description: string;
}

/**
 * 算力档位（RFC-001）：管理员定义「用哪个驱动、哪个模型」，业务只引用名字。
 * driver 与 model 是平台的采购信息，租户面的投影里不出现。
 */
export interface ComputeProfile {
  readonly name: string;
  readonly driver: AgentDriver;
  readonly model: string;
  readonly description: string;
}

export interface TaskProfile {
  readonly name: string;
  readonly cpu: string;
  readonly memory: string;
  readonly storage: string;
  readonly description: string;
}
