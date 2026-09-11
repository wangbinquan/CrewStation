// 每次运行的私有目录与其中的文件。
// ← agent-workflow `claudeCode/driver.ts` 的 `writeClaudeMcpConfig`（0o700 目录、0o600 文件）
// 与 `claudeCode/spawn.ts` 里 system.md 的写出；源的 `<appHome>/runs/<taskId>/<nodeRunId>` 布局不适用，
// CrewStation 一容器一任务，运行目录放 tmpdir 下按 agentId 分。
// 追加的一步是源里没有的 chown：TaskRunner 以 root 写文件，CLI 经 setpriv 降到 uid 10001 运行，
// 不交属主的话 0600 的 mcp-config.json 子进程读不到。

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ProcessHost } from '../contract/processHost';

export const RUN_DIR_PREFIX = 'crewstation-agents';

export function defaultRunDir(agentId: string): string {
  return join(tmpdir(), RUN_DIR_PREFIX, agentId);
}

export interface RunDirectory {
  readonly path: string;
  /** 写一个 0600 文件并把属主交给 worker，返回绝对路径。 */
  write(name: string, content: string): Promise<string>;
  /** 结束后清理；失败只记不抛。 */
  dispose(): void;
}

/** 建目录（0700）并把属主交给 worker；随后写入的文件同样 chown。 */
export async function createRunDirectory(path: string, host: ProcessHost): Promise<RunDirectory> {
  // 父目录必须可遍历：`mkdirSync(recursive, {mode})` 会把同一个 mode 套到它新建的**每一级**上，
  // 于是 <tmpdir>/crewstation-agents 也会变成 root 独占的 0700，降权后的 CLI 连自己的运行目录都进不去。
  // 父级用 0755（本身不放任何内容），只有按 agentId 分的叶目录是 0700 ＋ 交给 worker。
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
  mkdirSync(path, { recursive: true, mode: 0o700 });
  await host.chownToWorker(path);
  return {
    path,
    async write(name, content) {
      const file = join(path, name);
      writeFileSync(file, content, { mode: 0o600, flag: 'w' });
      await host.chownToWorker(file);
      return file;
    },
    dispose() {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // 清理失败不影响运行结果：容器消亡时 tmpdir 一并消失。
      }
    },
  };
}
