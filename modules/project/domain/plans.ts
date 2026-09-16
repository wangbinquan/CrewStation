import type { AgentDriver, RuntimeConfigId } from '@crewstation/contracts';

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
 * RFC-004：可选绑定一份管理员运行环境（runtimeConfigId）；没有绑定的档位继续走部署配置模式。
 * revision 每次写入递增，写操作用 expectedRevision 比较，旧客户端不能无意清掉绑定。
 */
export interface ComputeProfile {
  readonly name: string;
  readonly driver: AgentDriver;
  readonly model: string;
  readonly taskProfile?: string;
  readonly description: string;
  readonly runtimeConfigId?: RuntimeConfigId;
  readonly revision: number;
}

export interface TaskProfile {
  readonly name: string;
  readonly cpu: string;
  readonly memory: string;
  readonly storage: string;
  readonly description: string;
}

/** 运行环境目录对一个绑定的回答（由 agent-runtime 经端口提供）。 */
export interface RuntimeConfigSummary {
  readonly id: string;
  readonly name: string;
  readonly driver: 'claude-code' | 'opencode';
  readonly enabled: boolean;
  readonly activeRevision: number | null;
}

/**
 * 托管档位能否起 Agent：只看运行环境是否存在、已启用且有已启用版本。
 * 部署配置模式无法在平台侧验证凭据是否齐全，只能如实标为“部署配置模式”。
 */
export function computeAvailability(profile: ComputeProfile, runtime: RuntimeConfigSummary | undefined): { available: boolean; reason?: string } {
  if (!profile.runtimeConfigId) return { available: true };
  if (!runtime) return { available: false, reason: '绑定的运行环境不存在，请管理员重新绑定' };
  if (runtime.driver !== profile.driver) return { available: false, reason: `运行环境 ${runtime.name} 的 CLI（${runtime.driver}）与档位驱动（${profile.driver}）不一致` };
  if (!runtime.enabled) return { available: false, reason: `运行环境 ${runtime.name} 已停用，请管理员启用或改绑` };
  if (runtime.activeRevision === null) return { available: false, reason: `运行环境 ${runtime.name} 尚未启用任何版本，请管理员完成检查并启用` };
  return { available: true };
}
