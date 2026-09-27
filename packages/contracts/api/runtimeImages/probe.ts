import type { BeforeStartMaterial } from '../../taskrunner/beforeStart';
import type { LaunchSpec } from '../../taskrunner/launch';
import type { TerminalTest } from '../compute/computeProfile';
import type { RuntimeImageExecutionSnapshot, RuntimeImageValidationDto } from './responses';

/** 控制面内部隔离验证材料，不开放为客户端启动接口。凭据只经过受控通道。 */
export interface RuntimeImageProbeInput {
  validationId: string;
  projectId: string;
  deadline: string;
  snapshot: RuntimeImageExecutionSnapshot;
  agent?: { profileId: string; revision: number; launch: LaunchSpec; beforeStart: BeforeStartMaterial; taskProfile?: string; terminalTest?: TerminalTest };
}
export interface RuntimeImageProbeResult {
  state: 'passed' | 'failed' | 'unknown';
  observedImageId?: string;
  checks: RuntimeImageValidationDto['checks'];
  error?: string;
}
