import type { BeforeStartError, BeforeStartErrorCode } from '@crewstation/contracts';

/** 启动前 Hook 的失败：带协议级错误码与出错步骤；消息给租户看，因此不含脚本源码、文件正文或凭据。 */
export class BeforeStartFailure extends Error {
  constructor(readonly code: BeforeStartErrorCode, message: string, readonly stepId?: string) {
    super(message);
    this.name = 'BeforeStartFailure';
  }

  toError(): BeforeStartError {
    return { code: this.code, message: this.message, ...(this.stepId ? { stepId: this.stepId } : {}) };
  }
}

export function asBeforeStartFailure(error: unknown, stepId?: string): BeforeStartFailure {
  if (error instanceof BeforeStartFailure) return error;
  return new BeforeStartFailure('internal_error', error instanceof Error ? error.message : String(error), stepId);
}
