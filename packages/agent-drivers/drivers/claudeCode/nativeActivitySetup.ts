import type { DriverLaunchContext } from '../../contract/agentDriver';
import type { AgentSpawnContext } from '../../contract/spawnPlan';
import type { RunDirectory } from '../../process/runDirectory';
import { probeClaudeCode } from './probe';
import { claudeSessionHookCommand, renderClaudeSessionHook } from './nativeSessionHook';

/** CLI --settings 的 hooks 按事件追加合并；不覆盖项目／用户配置文件。 */
export async function setupClaudeNativeActivity(ctx: AgentSpawnContext, context: DriverLaunchContext, runDir: RunDirectory, env: Record<string, string>, cmd: string[]): Promise<'unsupported-version' | 'source-error' | undefined> {
  const channel = context.nativeActivity;
  if (!channel) return;
  try {
    const probe = await probeClaudeCode(context.host, ctx.head ?? ['claude'], { cwd: ctx.cwd, env, timeoutMs: 5000 });
    if (!probe.compatible || probe.version !== '2.1.268') return 'unsupported-version';
    // 已由操作者指定的遥测目的地／策略必须继续有效；冲突时仅放弃平台状态观察。
    if (Object.keys(env).some((key) => key.startsWith('OTEL_') || key === 'CLAUDE_CODE_ENABLE_TELEMETRY' || key === 'CLAUDE_CODE_ENHANCED_TELEMETRY_BETA')) return 'source-error';
    const hook = { type: 'http', url: `${channel.endpoint}/hooks`, timeout: 5 };
    const sessionScript = await runDir.write('activity-session.mjs', renderClaudeSessionHook(channel.endpoint));
    const sessionHook = { type: 'command', command: claudeSessionHookCommand(sessionScript), timeout: 5 };
    const events = ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'StopFailure'];
    const hooks = { ...Object.fromEntries(events.map((event) => [event, [{ hooks: [hook] }]])), SessionStart: [{ hooks: [sessionHook] }], ConfigChange: [{ hooks: [sessionHook] }] };
    const settings = await runDir.write('activity-settings.json', JSON.stringify({ hooks }));
    cmd.push('--settings', settings);
    Object.assign(env, {
      CLAUDE_CODE_ENABLE_TELEMETRY: '1', CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
      OTEL_TRACES_EXPORTER: 'otlp', OTEL_LOGS_EXPORTER: 'otlp', OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json', OTEL_EXPORTER_OTLP_ENDPOINT: channel.endpoint,
      OTEL_LOGS_EXPORT_INTERVAL: '1000', OTEL_TRACES_EXPORT_INTERVAL: '1000', OTEL_METRIC_EXPORT_INTERVAL: '5000',
      OTEL_EXPORTER_OTLP_TIMEOUT: '3000', OTEL_BLRP_MAX_QUEUE_SIZE: '8192', OTEL_BSP_MAX_QUEUE_SIZE: '8192',
      OTEL_LOG_USER_PROMPTS: '0', OTEL_LOG_ASSISTANT_RESPONSES: '0', OTEL_LOG_TOOL_DETAILS: '0', OTEL_LOG_TOOL_CONTENT: '0', OTEL_LOG_RAW_API_BODIES: '0',
    });
    return;
  } catch {
    context.logger.warn('native activity observer unavailable; CLI remains usable');
    return 'source-error';
  }
}
