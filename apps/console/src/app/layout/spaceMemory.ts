/**
 * 空间往返时记住离开租户空间前的位置（RFC-002 §2.3）。
 * 只放在模块级变量里，不进 localStorage：这是一次会话内的便利，不是需要跨设备持久的偏好，
 * 写进 localStorage 反而会让「昨天关掉的页面今天又跳回来」。
 */
let lastWorkbenchPath = '/';

export function rememberWorkbenchPath(path: string): void {
  if (path.startsWith('/admin')) return;
  lastWorkbenchPath = path;
}

export function recallWorkbenchPath(): string {
  return lastWorkbenchPath;
}
