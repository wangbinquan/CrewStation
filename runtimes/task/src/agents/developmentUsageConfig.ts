import { DevelopmentUsageRuntimeConfigSchema, DevelopmentUsageReceiptSchema, type DevelopmentUsageRuntimeConfig } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';

export type DevelopmentUsageConfig = Omit<DevelopmentUsageRuntimeConfig, 'directory' | 'bindingDirectory'> & { directory: string; bindingDirectory: string; podUid: string };

/** Only the immutable new-Pod render selects this path; old Runner environments remain unchanged. */
export function loadDevelopmentUsageConfig(env: Record<string, string | undefined>): DevelopmentUsageConfig | undefined {
  const raw = env.CS_RUNNER_DEVELOPMENT_USAGE;
  if (raw === undefined) return undefined;
  try {
    if (Buffer.byteLength(raw) > 4096) throw new Error('oversized');
    const config = DevelopmentUsageRuntimeConfigSchema.parse(JSON.parse(raw));
    const podUid = DevelopmentUsageReceiptSchema.shape.podUid.parse(env.CS_RUNTIME_POD_UID);
    return { ...config, podUid };
  } catch { throw new RunnerCommandError('development_usage_config_invalid', '开发数值日志配置或 Pod 身份无效'); }
}
