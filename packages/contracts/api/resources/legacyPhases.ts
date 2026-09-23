import type { ResourceConditionStatus, ResourcePhase } from './resourceRecord';

/**
 * RFC-025 设计 §4.3：旧状态词汇 → 标准阶段（附带需要的条件）。收编（设计 §6.5）按它给旧对象定初始阶段；
 * 迁移期间旧接口照旧返回旧字段，值反过来由阶段推导（§11.2，见 cliLifecycleOfPhase）。
 */
export interface LegacyPhase {
  readonly phase: ResourcePhase;
  readonly condition?: { readonly type: string; readonly status: ResourceConditionStatus };
}

const at = (phase: ResourcePhase, condition?: LegacyPhase['condition']): LegacyPhase => (condition ? { phase, condition } : { phase });

/** 任务环境（EnvironmentState）：running 还要 Runner 连上才是运行中。 */
export function phaseOfEnvironment(state: 'creating' | 'running' | 'paused' | 'releasing' | 'released' | 'failed', connected: boolean): LegacyPhase {
  switch (state) {
    case 'creating': return at('provisioning');
    case 'running': return connected ? at('ready', { type: 'RunnerConnected', status: 'true' }) : at('starting', { type: 'RunnerConnected', status: 'false' });
    case 'paused': return at('stopped', { type: 'Paused', status: 'true' });
    case 'releasing': return at('stopping');
    case 'released': return at('stopped');
    case 'failed': return at('failed');
  }
}

/** Agent 执行环境的 native.state。 */
export function phaseOfNativeState(state: 'queued' | 'starting' | 'running' | 'cleaning' | 'finished'): LegacyPhase {
  return at(({ queued: 'pending', starting: 'starting', running: 'ready', cleaning: 'stopping', finished: 'stopped' } as const)[state]);
}

/** CLI 标签的 lifecycle；受理了结束（stopRequested）就是结束中。 */
export function phaseOfCliLifecycle(lifecycle: 'starting' | 'running' | 'ended' | 'failed' | 'unknown', stopRequested = false): LegacyPhase {
  if (stopRequested && (lifecycle === 'starting' || lifecycle === 'running' || lifecycle === 'unknown')) return at('stopping');
  return at(({ starting: 'starting', running: 'ready', ended: 'stopped', failed: 'failed', unknown: 'degraded' } as const)[lifecycle]);
}

/** 开发会话（DevSessionState）。 */
export function phaseOfDevSession(state: 'creating' | 'running' | 'releasing' | 'released' | 'failed'): LegacyPhase {
  return at(({ creating: 'provisioning', running: 'ready', releasing: 'stopping', released: 'stopped', failed: 'failed' } as const)[state]);
}

/** 重建：工作区记录的分配中／启动中，带条件 Rebuilding；旧 Pod 是被替换的子对象。 */
export function phaseOfRebuild(state: 'queued' | 'replacing' | 'starting' | 'ready' | 'failed'): LegacyPhase {
  if (state === 'ready') return at('ready', { type: 'Rebuilding', status: 'false' });
  if (state === 'failed') return at('failed', { type: 'Rebuilding', status: 'false' });
  return at(state === 'starting' ? 'starting' : 'provisioning', { type: 'Rebuilding', status: 'true' });
}

/** 发布槽的健康（SlotHealth）：empty 是已结束（已下线或尚未部署）。 */
export function phaseOfSlotHealth(health: 'empty' | 'deploying' | 'ready' | 'degraded' | 'failed'): LegacyPhase {
  return at(({ empty: 'stopped', deploying: 'starting', ready: 'ready', degraded: 'degraded', failed: 'failed' } as const)[health]);
}

/** 部署健康：崩溃重启与观测不可用都是降级，分别带条件。 */
export function phaseOfHealth(health: 'healthy' | 'degraded' | 'crash-looping' | 'unhealthy' | 'unknown'): LegacyPhase {
  switch (health) {
    case 'healthy': return at('ready');
    case 'degraded': return at('degraded');
    case 'crash-looping': return at('degraded', { type: 'CrashLooping', status: 'true' });
    case 'unhealthy': return at('failed');
    case 'unknown': return at('degraded', { type: 'Observed', status: 'unknown' });
  }
}

/** 数据资源。 */
export function phaseOfDataResource(state: 'requested' | 'provisioning' | 'ready' | 'failed' | 'releasing' | 'released'): LegacyPhase {
  return at(({ requested: 'pending', provisioning: 'provisioning', ready: 'ready', failed: 'failed', releasing: 'stopping', released: 'stopped' } as const)[state]);
}

/** §11.2 反向：旧接口的 CLI lifecycle 由阶段推导；结束中仍报 running（stopRequested 期间的旧语义）。 */
export function cliLifecycleOfPhase(phase: ResourcePhase): 'starting' | 'running' | 'ended' | 'failed' | 'unknown' {
  return ({ pending: 'starting', provisioning: 'starting', starting: 'starting', ready: 'running', stopping: 'running', stopped: 'ended', failed: 'failed', degraded: 'unknown' } as const)[phase];
}
