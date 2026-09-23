import type { PlatformError } from '@crewstation/kernel';
import { precondition } from '@crewstation/kernel';

/**
 * 统一预检的标准原因（RFC-025 设计 §5、B4）：原因码＋说明＋出路。预检不过不受理、不写库，返回 412：message 是说明加出路的完整句子
 * （工作台、命令行、MCP 照读），details 里另给原因码与出路，供程序分辨。
 */
export interface PrecheckReason {
  readonly code: string;
  readonly message: string;
  readonly hint?: string;
}

export const precheckReason = (code: string, message: string, hint?: string): PrecheckReason => ({ code, message, ...(hint ? { hint } : {}) });

/** 说明与出路连成一句：一行写清为什么不行、该怎么办。 */
export function reasonText(reason: PrecheckReason): string {
  return reason.hint ? `${reason.message}。${reason.hint}` : reason.message;
}

export function precheckFailed(reason: PrecheckReason, extra: Readonly<Record<string, unknown>> = {}): PlatformError {
  return precondition(reasonText(reason), { ...extra, code: reason.code, ...(reason.hint ? { hint: reason.hint } : {}) });
}
