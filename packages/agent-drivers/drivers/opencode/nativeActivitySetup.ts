import { join } from 'node:path';
import type { DriverLaunchContext } from '../../contract/agentDriver';
import type { AgentSpawnContext } from '../../contract/spawnPlan';
import type { RunDirectory } from '../../process/runDirectory';
import { seedOpencodePluginDependencies } from '../../process/opencodePluginDependencies';
import { ensureOpencodeBinaryVersion } from './probe';
import { renderOpencodeActivityPlugin } from './nativeActivityPlugin';

export async function setupOpencodeNativeActivity(ctx: AgentSpawnContext, context: DriverLaunchContext, runDir: RunDirectory, env: Record<string, string>, configDir: string): Promise<'unsupported-version' | 'source-error' | undefined> {
  const channel = context.nativeActivity;
  if (!channel) return;
  try {
    const version = await ensureOpencodeBinaryVersion(context.host, [...ctx.head], { cwd: ctx.cwd, env, timeoutMs: 5000 });
    if (version !== '1.18.29') return 'unsupported-version';
    const globalConfig = join(env.XDG_CONFIG_HOME ?? join(env.HOME ?? ctx.cwd, '.config'), 'opencode');
    await seedOpencodePluginDependencies(channel.opencodeDependencies ?? '/opt/crewstation-opencode-plugin', globalConfig, context.host);
    await seedOpencodePluginDependencies(channel.opencodeDependencies ?? '/opt/crewstation-opencode-plugin', configDir, context.host);
    const plugin = await runDir.write('activity-observer.mjs', renderOpencodeActivityPlugin(channel.endpoint, channel.token));
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!);
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ ...config, plugin: [...(config.plugin ?? []), `file://${plugin}`] });
    return;
  } catch {
    context.logger.warn('native activity observer unavailable; CLI remains usable');
    return 'source-error';
  }
}
