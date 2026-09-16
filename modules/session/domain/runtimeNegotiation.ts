import type { RunnerCommand, RunnerHello, ScriptStep } from '@crewstation/contracts';
import { PlatformError } from '@crewstation/kernel';

const LANGUAGE_LABEL: Record<string, string> = { shell: 'Shell（bash）', python: 'Python 3', javascript: 'JavaScript（bun）' };

/**
 * RFC-004：托管启动材料只能发给声明了 agentRuntimeConfig 能力且装有所需解释器的 Runner。
 * 在写 socket 之前拒绝：旧 Runner 会把未知字段静默丢掉，等于以“部署配置模式”偷跑一个托管 Agent。
 */
export function assertRuntimeSupported(command: RunnerCommand, capabilities: RunnerHello['capabilities']): void {
  if (command.type !== 'startAgent' && command.type !== 'startAgentTerminal') return;
  const runtime = command.runtime;
  if (!runtime) return;
  if (capabilities.agentRuntimeConfig !== 1) {
    throw new PlatformError('precondition', '当前任务容器不支持管理员运行环境；请保存工作并在容器更新后重新开启会话', { code: 'agent_runtime_unavailable', configId: runtime.configId, revision: runtime.revision });
  }
  const available = new Set((capabilities.interpreters ?? []).map((i) => i.language));
  const scripts = runtime.steps.filter((s): s is ScriptStep => s.kind === 'script' && s.language !== 'custom');
  const missing = [...new Set(scripts.map((s) => s.language))].filter((language) => !available.has(language as 'shell'));
  if (missing.length > 0) {
    throw new PlatformError('precondition', `当前任务容器缺少运行环境 ${runtime.configName} 需要的解释器：${missing.map((l) => LANGUAGE_LABEL[l] ?? l).join('、')}；请管理员确认任务镜像`, { code: 'interpreter_unavailable', missing, configId: runtime.configId, revision: runtime.revision });
  }
}
