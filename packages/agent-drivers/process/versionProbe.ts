// ← agent-workflow `util/process.ts` 的 `spawnVersionProbe` 骨架（POSIX 分支）。
// 差异：不自己 Bun.spawn，而是经 ProcessHost（降权 + 独立进程组由宿主负责）；
// 到期后调宿主的 killTree 而不是自己发 SIGKILL 给进程组；Windows 分支与 maxBytes 形态不复制。

import type { ProcessHost } from '../contract/processHost';

/** 源的具名默认值：调用方不给超时就用它（源里「省略即无超时」的模式已被删除）。 */
export const DEFAULT_VERSION_PROBE_TIMEOUT_MS = 10_000;
/** 探针输出上限：`--version` 只有一行，超出即截断，避免坏二进制刷屏。 */
const MAX_PROBE_CHARS = 8 * 1024;

export interface VersionProbeResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** 跑 `<head...> --version`，收集有界输出；到期杀整棵树并置 timedOut。 */
export async function spawnVersionProbe(
  host: ProcessHost,
  head: readonly string[],
  options: { cwd: string; env: Record<string, string>; timeoutMs?: number },
): Promise<VersionProbeResult> {
  const child = host.spawnPiped({ cmd: [...head, '--version'], cwd: options.cwd, env: options.env });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void host.killTree(child, 0);
  }, options.timeoutMs ?? DEFAULT_VERSION_PROBE_TIMEOUT_MS);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const collect = (into: string[]) => (line: string): void => {
    if (into.join('\n').length < MAX_PROBE_CHARS) into.push(line);
  };
  try {
    // 先等退出再等泵读尽：孙进程持着管道时 exited 会先到，泵靠 EOF 自然收尾。
    await Promise.all([
      child.exited,
      host.pumpLines(child.stdout, collect(stdout)),
      host.pumpLines(child.stderr, collect(stderr)),
    ]);
  } finally {
    clearTimeout(timer);
  }
  return { exitCode: child.exitCode, stdout: stdout.join('\n'), stderr: stderr.join('\n'), timedOut };
}
