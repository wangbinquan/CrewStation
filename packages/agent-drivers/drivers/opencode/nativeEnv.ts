import { validation } from '@crewstation/kernel';
import type { AgentSpawnContext } from '../../contract/spawnPlan';
import { buildOpencodeEnv } from './env';

/** 原生 TUI 遇到不可用模型会自动回退；只暴露平台选定模型，不能悄悄换成内置免费档。 */
export function buildOpencodeNativeEnv(ctx: AgentSpawnContext, configDir: string): Record<string, string> {
  const separator = ctx.model?.indexOf('/') ?? -1;
  if (!ctx.model || separator < 1 || separator === ctx.model.length - 1) throw validation('OpenCode 算力档位的模型必须为 provider/model');
  const provider = ctx.model.slice(0, separator);
  const model = ctx.model.slice(separator + 1);
  const { env } = buildOpencodeEnv(ctx, configDir);
  const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!) as Record<string, unknown>;
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ ...config, model: ctx.model, small_model: ctx.model, enabled_providers: [provider], provider: { [provider]: { whitelist: [model] } } });
  return env;
}
