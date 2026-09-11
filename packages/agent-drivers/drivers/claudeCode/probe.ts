// ← agent-workflow `runtime/claudeCode/probe.ts`。
// 可用性只看 `--version` 是否退出 0；版本号是**遥测**，自定义 fork 可能报不出 X.Y.Z，
// 因此版本解析不出来不影响 compatible。协议一致性由深度冒烟另行确认。

import type { Logger } from '@crewstation/kernel';
import type { ProcessHost } from '../../contract/processHost';
import { DEFAULT_VERSION_PROBE_TIMEOUT_MS, spawnVersionProbe } from '../../process/versionProbe';
import { compareSemver, extractVersion } from '../../process/semver';

/** 官方发行版的建议下限；低于它只告警，不拒绝运行（源同）。 */
export const MIN_CLAUDE_CODE_VERSION = '2.0.0';

export interface CliProbeResult {
  binary: string;
  version: string | null;
  /** `--version` 退出 0 即为可用。 */
  compatible: boolean;
  /** 版本低于建议下限时的说明文案。 */
  belowMinimum?: string;
}

export interface ProbeOptions {
  cwd: string;
  env: Record<string, string>;
  timeoutMs?: number;
  logger?: Logger;
}

export async function probeClaudeCode(host: ProcessHost, head: readonly string[] = ['claude'], options: ProbeOptions): Promise<CliProbeResult> {
  const binary = head[0] ?? 'claude';
  const log = options.logger;
  const result = await spawnVersionProbe(host, head, {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs ?? DEFAULT_VERSION_PROBE_TIMEOUT_MS,
  });
  if (result.timedOut) {
    log?.warn('claude --version timed out', { binary, timeoutMs: options.timeoutMs });
    return { binary, version: null, compatible: false };
  }
  if (result.exitCode !== 0) {
    log?.warn('claude --version non-zero exit', { binary, exitCode: result.exitCode });
    return { binary, version: null, compatible: false };
  }
  const version = extractVersion(result.stdout);
  const belowMinimum = version !== null && compareSemver(version, MIN_CLAUDE_CODE_VERSION) < 0
    ? `claude ${version} 低于建议下限 ${MIN_CLAUDE_CODE_VERSION}`
    : undefined;
  if (belowMinimum !== undefined) log?.warn('claude-code below minimum version', { binary, version, minimum: MIN_CLAUDE_CODE_VERSION });
  return { binary, version, compatible: true, ...(belowMinimum === undefined ? {} : { belowMinimum }) };
}
