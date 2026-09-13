import type { RunnerCommand } from '@crewstation/contracts';
import { COMPARISON_COMMAND_TIMEOUT_MS, COMPARISON_HISTORY_TIMEOUT_MS, WORKSPACE_COMMAND_TIMEOUT_MS } from '@crewstation/contracts';

/** 给有界 Git 操作留出结果传输余量；其他命令沿用既有会话设置。 */
export function commandTimeout(command: RunnerCommand): { timeoutMs?: number } {
  if (command.type === 'fetchComparisonHistory') return { timeoutMs: COMPARISON_HISTORY_TIMEOUT_MS + 10_000 };
  if (command.type === 'compareWorkspace' || command.type === 'workspaceComparisonDetails') return { timeoutMs: COMPARISON_COMMAND_TIMEOUT_MS + 10_000 };
  if (command.type === 'workspaceStatus') return { timeoutMs: WORKSPACE_COMMAND_TIMEOUT_MS + 10_000 };
  return {};
}
