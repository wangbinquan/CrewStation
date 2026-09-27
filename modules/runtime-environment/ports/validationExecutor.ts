import type { RuntimeImageExecutionSnapshot, RuntimeImageValidationDto } from '@crewstation/contracts';
import type { ImageValidation } from '../domain/records';

export interface RuntimeImageValidationResult {
  readonly verification?: 'runtime' | 'service-contract';
  readonly state: 'passed' | 'failed' | 'unknown';
  readonly observedImageId?: string;
  readonly checks: RuntimeImageValidationDto['checks'];
  readonly error?: string;
}
export interface RuntimeImageValidationContext {
  readonly validation: ImageValidation;
  readonly snapshot: RuntimeImageExecutionSnapshot;
}
export interface RuntimeImageValidationExecutor {
  /** 必须以 validation.id 固定物理身份，停止入口须留下墓碑，阻止迟到创建。 */
  run(context: RuntimeImageValidationContext, heartbeat: () => Promise<boolean>): Promise<RuntimeImageValidationResult>;
  /** 真正停止并清理才返回 true；不可把删除请求已发送当成完成。 */
  stop(context: RuntimeImageValidationContext): Promise<boolean>;
}
