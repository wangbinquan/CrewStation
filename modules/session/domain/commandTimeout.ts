import type { RunnerCommand } from '@crewstation/contracts';
import { API_INVOCATION_TIMEOUT_MS, COMPARISON_COMMAND_TIMEOUT_MS, COMPARISON_HISTORY_TIMEOUT_MS, WORKSPACE_COMMAND_TIMEOUT_MS } from '@crewstation/contracts';

/** 给有界 Git 操作留出结果传输余量；其他命令沿用既有会话设置。 */
export function commandTimeout(command: RunnerCommand): { timeoutMs?: number } {
  if (command.type === 'invokeApi') return { timeoutMs: API_INVOCATION_TIMEOUT_MS + 10_000 };
  if (command.type === 'fetchComparisonHistory') return { timeoutMs: COMPARISON_HISTORY_TIMEOUT_MS + 10_000 };
  if (command.type === 'compareWorkspace' || command.type === 'workspaceComparisonDetails') return { timeoutMs: COMPARISON_COMMAND_TIMEOUT_MS + 10_000 };
  if (command.type === 'workspaceStatus') return { timeoutMs: WORKSPACE_COMMAND_TIMEOUT_MS + 10_000 };
  // 档位测试的通用终端命令：先跑完启动前脚本再执行测试命令，回执要等两段都结束（RFC-006 §6.2）。
  if (command.type === 'probeTerminal') return { timeoutMs: command.timeoutMs + command.beforeStart.steps.reduce((sum, s) => sum + (s.kind === 'script' ? s.timeoutMs : 0), 0) + 30_000 };
  return {};
}
