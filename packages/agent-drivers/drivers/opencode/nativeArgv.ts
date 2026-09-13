import type { AgentSpawnContext } from '../../contract/spawnPlan';
import { OPENCODE_AGENT_NAME } from './argv';

/** opencode 1.18.29 --help：缺省即 TUI；不传 run／--format json，也不使用复用最近会话的 --continue。 */
export function buildOpencodeNativeArgv(ctx: AgentSpawnContext): string[] {
  return [...(ctx.head ?? ['opencode']), '--agent', OPENCODE_AGENT_NAME, ...(ctx.model ? ['--model', ctx.model] : [])];
}
