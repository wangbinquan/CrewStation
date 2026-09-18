// 宿主端口：本包不自己 spawn，也不自己杀进程树、不自己解码流。
// 理由是 runtimes/task 的 ProcessLauncher 会给每个子进程套 setpriv 降权（root → uid 10001），
// 绕过它就等于以 root 跑 Agent；processTree.ts／streamPump.ts 也已经有宿主实现，
// 复制一份只会出现两种杀树语义。于是本包声明端口，由 runtimes/task 的接线代码提供实现。
// 与 agent-workflow 的差异：源里 managedProcess.ts 直接 Bun.spawn 并自带 Windows 分支、
// 预激活 launcher、进程树收养；这里全部删除（CrewStation 只跑 Linux 容器，且 tini 收割孤儿）。

/** 一次子进程拉起的规格；与宿主 ProcessLauncher.LaunchSpec 结构一致。 */
export interface DriverLaunchSpec {
  cmd: string[];
  cwd: string;
  env: Record<string, string>;
}

/** 子进程句柄的结构子集：只用得到这几项，便于测试替身实现。 */
export interface DriverChildProcess {
  readonly pid: number;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<number>;
  readonly exitCode: number | null;
  readonly signalCode: string | null;
}

/** stdin 也是管道的子进程：交互式常驻 Claude 与 oneshot 的 prompt 投递都走它。 */
export interface DriverChildProcessWithStdin extends DriverChildProcess {
  readonly stdin: { write(chunk: string): void; flush?(): void; end(): void };
}

export interface ProcessHost {
  /** stdin 关闭、stdout／stderr 管道、独立进程组。 */
  spawnPiped(spec: DriverLaunchSpec): DriverChildProcess;
  /** stdin 为管道；prompt 或 stream-json 输入帧经此写入。 */
  spawnWithStdin(spec: DriverLaunchSpec): DriverChildProcessWithStdin;
  /** 杀整棵进程树：SIGTERM → 宽限 → SIGKILL（宿主 processTree.ts 的实现）。 */
  killTree(child: DriverChildProcess, graceMs?: number): Promise<void>;
  /** 按行泵送一条输出流（UTF-8 流式解码、行切分、单行上限）；宿主 streamPump.ts 的实现。 */
  pumpLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void>;
  /** 把运行目录与其中的文件交给 worker，否则降权后的 CLI 读不到 0600 的 mcp-config.json。 */
  chownToWorker(path: string): Promise<void>;
  /** 解析可执行文件（绝对路径或 PATH 上的名字）；供版本探测等辅助调用。 */
  which(binary: string): string | null;
}
