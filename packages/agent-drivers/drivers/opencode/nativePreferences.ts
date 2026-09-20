import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import type { DriverLaunchContext } from '../../contract/agentDriver';

/** OpenCode 1.18 的 TUI 偏好位于 $XDG_STATE_HOME/opencode/kv.json；新会话直接显示历史滚动条。 */
export async function seedOpencodeNativePreferences(context: DriverLaunchContext): Promise<void> {
  const home = context.managed?.home;
  if (!home) return;
  const xdg = context.env.XDG_STATE_HOME;
  const state = join(xdg && isAbsolute(xdg) ? xdg : join(home, '.local', 'state'), 'opencode');
  const firstCreated = await mkdir(state, { recursive: true, mode: 0o700 });
  // mkdir(recursive) 的所有新父目录也要可由 worker 遍历；不修改已有目录的属主。
  if (firstCreated) {
    for (let directory = state; ; directory = dirname(directory)) {
      await context.host.chownToWorker(directory);
      if (directory === firstCreated) break;
    }
  }
  const file = join(state, 'kv.json');
  try { await writeFile(file, JSON.stringify({ scrollbar_visible: true }), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    // 偏好由 CLI 自己保存：不覆盖用户关闭滚动条的选择，也不与其他会话争写文件。
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw error;
  }
  await context.host.chownToWorker(file);
}
