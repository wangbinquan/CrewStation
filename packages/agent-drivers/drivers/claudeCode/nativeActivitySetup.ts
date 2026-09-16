import type { DriverLaunchContext } from '../../contract/agentDriver';
import type { AgentSpawnContext } from '../../contract/spawnPlan';
import type { RunDirectory } from '../../process/runDirectory';
import { probeClaudeCode } from './probe';
import { claudeSessionHookCommand, renderClaudeSessionHook } from './nativeSessionHook';

export type ClaudeActivityHooks = Record<string, Array<Record<string, unknown>>>;
export type ClaudeActivitySetup = { hooks: ClaudeActivityHooks } | { unavailable: 'unsupported-version' | 'source-error' } | undefined;

/**
 * 状态观测的 hooks 与 telemetry 环境：hooks 由调用方与管理员 settings.json 合成为唯一的 `--settings` 文件（RFC-004 §6）；
 * 不覆盖项目／用户配置文件。
 */
export async function setupClaudeNativeActivity(ctx: AgentSpawnContext, context: DriverLaunchContext, runDir: RunDirectory, env: Record<string, string>): Promise<ClaudeActivitySetup> {
  const channel = context.nativeActivity;
  if (!channel) return undefined;
  try {
    const probe = await probeClaudeCode(context.host, ctx.head ?? ['claude'], { cwd: ctx.cwd, env, timeoutMs: 5000 });
    if (!probe.compatible || probe.version !== '2.1.268') return { unavailable: 'unsupported-version' };
    // 已由操作者指定的遥测目的地／策略必须继续有效；冲突时仅放弃平台状态观察。
    if (Object.keys(env).some((key) => key.startsWith('OTEL_') || key === 'CLAUDE_CODE_ENABLE_TELEMETRY' || key === 'CLAUDE_CODE_ENHANCED_TELEMETRY_BETA')) return { unavailable: 'source-error' };
    const hook = { type: 'http', url: `${channel.endpoint}/hooks`, timeout: 5 };
    const sessionScript = await runDir.write('activity-session.mjs', renderClaudeSessionHook(channel.endpoint));
    const sessionHook = { type: 'command', command: claudeSessionHookCommand(sessionScript), timeout: 5 };
    const events = ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'StopFailure'];
    const hooks: ClaudeActivityHooks = { ...Object.fromEntries(events.map((event) => [event, [{ hooks: [hook] }]])), SessionStart: [{ hooks: [sessionHook] }], ConfigChange: [{ hooks: [sessionHook] }] };
    Object.assign(env, {
      CLAUDE_CODE_ENABLE_TELEMETRY: '1', CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
      OTEL_TRACES_EXPORTER: 'otlp', OTEL_LOGS_EXPORTER: 'otlp', OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json', OTEL_EXPORTER_OTLP_ENDPOINT: channel.endpoint,
      OTEL_LOGS_EXPORT_INTERVAL: '1000', OTEL_TRACES_EXPORT_INTERVAL: '1000', OTEL_METRIC_EXPORT_INTERVAL: '5000',
      OTEL_EXPORTER_OTLP_TIMEOUT: '3000', OTEL_BLRP_MAX_QUEUE_SIZE: '8192', OTEL_BSP_MAX_QUEUE_SIZE: '8192',
      OTEL_LOG_USER_PROMPTS: '0', OTEL_LOG_ASSISTANT_RESPONSES: '0', OTEL_LOG_TOOL_DETAILS: '0', OTEL_LOG_TOOL_CONTENT: '0', OTEL_LOG_RAW_API_BODIES: '0',
    });
    return { hooks };
  } catch {
    context.logger.warn('native activity observer unavailable; CLI remains usable');
    return { unavailable: 'source-error' };
  }
}
