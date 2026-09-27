import { validation } from '@crewstation/kernel';

export function executionCursor(taskId: string, sequence: number, subtaskId?: string, generation = 1): string {
  return Buffer.from(JSON.stringify({ taskId, sequence, generation, subtaskId: subtaskId ?? null })).toString('base64url');
}
export function readExecutionCursor(cursor: string | undefined, taskId: string, subtaskId?: string): { sequence: number; generation: number } {
  if (!cursor) return { sequence: 0, generation: 1 };
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (value.taskId === taskId && value.subtaskId === (subtaskId ?? null) && Number.isSafeInteger(value.sequence) && value.sequence >= 0 && Number.isSafeInteger(value.generation ?? 1) && (value.generation ?? 1) > 0) return { sequence: value.sequence, generation: value.generation ?? 1 };
  } catch { /* A cursor is data, never a SQL fragment. */ }
  throw validation('事件游标不属于该任务或筛选范围', { code: 'invalid_cursor' });
}
