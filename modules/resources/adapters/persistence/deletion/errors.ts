import { precondition } from '@crewstation/kernel';

/** SQL 屏障保护可信内部写和迟到回调；对使用者暴露稳定的生命周期错误。 */
export function resourceDeletionWriteError(error: unknown): never {
  let cause = error;
  for (let depth = 0; cause && depth < 4; depth++) {
    const value = cause as { code?: string; message?: string; cause?: unknown };
    if (value.code === '55000' && value.message?.startsWith('project ')) throw precondition('项目资源已进入永久清理，不能重新准入或修改原归属', { code: 'project_deleting' });
    cause = value.cause;
  }
  throw error;
}
