import type { NativeTerminalDto, ResourcePhase } from '@crewstation/contracts';

/**
 * 旧接口的 lifecycle 由台账推导（RFC-025 设计 §11.2）：执行记录已结束就是 ended（Runner 报的 failed 照旧），失败就是 failed——
 * 结束、失败以台账为准，不会出现「关掉的 CLI 回来又是运行中」；启动与运行中的细节（RFC-022 步骤、RFC-024 界面就绪）仍按 Runner，
 * 结束中仍报 running（受理结束期间的旧语义）。带上可选的 phase，读名册的一方不必另查台账。
 */
export function withExecutionPhase(item: NativeTerminalDto, phase: ResourcePhase | undefined): NativeTerminalDto {
  if (!phase) return item;
  const lifecycle = phase === 'failed' ? 'failed' : phase === 'stopped' ? (item.lifecycle === 'failed' ? 'failed' : 'ended') : item.lifecycle;
  return { ...item, lifecycle, phase };
}
