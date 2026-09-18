import type { RunnerCommand, RunnerHello, ScriptStep, TaskId } from '@crewstation/contracts';
import { TASKRUNNER_PROTOCOL_VERSION, TaskIdSchema } from '@crewstation/contracts';
import { PlatformError } from '@crewstation/kernel';

const LANGUAGE_LABEL: Record<string, string> = { shell: 'Shell（bash）', python: 'Python 3', javascript: 'JavaScript（bun）' };

/**
 * RFC-006：档位的启动只能发给理解该协议、且装有启动前脚本所需解释器的 Runner。在写 socket 之前拒绝，
 * 让原因以管理员能处理的话回到调用方，而不是让 Runner 半途失败。
 */
export function assertLaunchSupported(command: RunnerCommand, capabilities: RunnerHello['capabilities']): void {
  if (command.type !== 'startAgent' && command.type !== 'startAgentTerminal' && command.type !== 'probeTerminal') return;
  const material = command.beforeStart;
  if (!capabilities.protocols.includes(command.launch.protocol)) {
    throw new PlatformError('precondition', `当前任务容器里的 Runner 不支持 ${command.launch.protocol} 协议；请基于当前平台底座镜像重建镜像`, { code: 'protocol_unsupported', protocol: command.launch.protocol, profile: material.profile, revision: material.revision });
  }
  const available = new Set((capabilities.interpreters ?? []).map((i) => i.language));
  const scripts = material.steps.filter((s): s is ScriptStep => s.kind === 'script' && s.language !== 'custom');
  const missing = [...new Set(scripts.map((s) => s.language))].filter((language) => !available.has(language as 'shell'));
  if (missing.length > 0) {
    throw new PlatformError('precondition', `当前任务容器缺少算力档位 ${material.profile} 的启动前脚本需要的解释器：${missing.map((l) => LANGUAGE_LABEL[l] ?? l).join('、')}；请管理员确认镜像`, { code: 'interpreter_unavailable', missing, profile: material.profile, revision: material.revision });
  }
}

export interface ProtocolMismatch { readonly taskId: TaskId; readonly runnerToken: string; readonly runnerProtocol: number | null; readonly message: string }

/**
 * 协议不一致的 hello（旧底座镜像里的 Runner，RFC-006 §5.3）：严格解析会把它当成坏帧，原因就丢了。
 * 这里只认出任务与令牌，令牌校验与回写原因由调用方做；其余形状不对的帧仍按坏帧处理。
 */
export function protocolMismatchOf(raw: unknown): ProtocolMismatch | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const frame = raw as Record<string, unknown>;
  if (frame.type !== 'hello' || frame.protocolVersion === TASKRUNNER_PROTOCOL_VERSION) return undefined;
  const taskId = TaskIdSchema.safeParse(frame.taskId);
  if (!taskId.success || typeof frame.runnerToken !== 'string' || frame.runnerToken.length === 0) return undefined;
  const runnerProtocol = typeof frame.protocolVersion === 'number' && Number.isInteger(frame.protocolVersion) ? frame.protocolVersion : null;
  return { taskId: taskId.data, runnerToken: frame.runnerToken, runnerProtocol, message: `Runner 协议版本 ${runnerProtocol ?? '未知'}，平台要求 ${TASKRUNNER_PROTOCOL_VERSION}；请基于当前平台底座镜像重建镜像` };
}
