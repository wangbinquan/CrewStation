// 测试替身：不拉起任何真实进程，按脚本回放 stdout／stderr。真实 CLI 不需要安装。

import type {
  DriverChildProcess,
  DriverChildProcessWithStdin,
  DriverLaunchSpec,
  ProcessHost,
} from '../contract/processHost';

export interface ScriptedTurn {
  /** 本次拉起要吐出的 stdout 行。 */
  stdout: string[];
  stderr?: string[];
  exitCode?: number;
  /** 常驻模式：每收到一帧 stdin 就再吐这些行。 */
  onFrame?: (frame: string) => string[];
}

export interface RecordedSpawn extends DriverLaunchSpec {
  stdinWrites: string[];
  stdinEnded: boolean;
}

export interface FakeHost extends ProcessHost {
  readonly spawns: RecordedSpawn[];
  readonly chownedPaths: string[];
  /** 常驻子进程：测试用它模拟进程在 stdin 关闭或被杀之前一直不退出。 */
  finishResident(exitCode?: number): void;
}

export function createFakeProcessHost(turns: ScriptedTurn[], options: { which?: (b: string) => string | null } = {}): FakeHost {
  const spawns: RecordedSpawn[] = [];
  const chownedPaths: string[] = [];
  let finishCurrent: ((exitCode: number) => void) | undefined;

  const makeChild = (spec: DriverLaunchSpec, withStdin: boolean): DriverChildProcessWithStdin => {
    const turn = turns[spawns.length] ?? { stdout: [] };
    const record: RecordedSpawn = { ...spec, stdinWrites: [], stdinEnded: false };
    spawns.push(record);
    const stdoutLines = [...turn.stdout];
    const resident = turn.onFrame !== undefined;
    let stdoutOpen = true;
    let pushLine: ((line: string) => void) | undefined;
    let closeStdout: (() => void) | undefined;
    const stdout = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        pushLine = (line) => {
          if (stdoutOpen) controller.enqueue(encoder.encode(`${line}\n`));
        };
        closeStdout = () => {
          if (!stdoutOpen) return;
          stdoutOpen = false;
          controller.close();
        };
        for (const line of stdoutLines) pushLine(line);
        if (!resident) closeStdout();
      },
    });
    const stderr = streamOf(turn.stderr ?? []);
    let exitCode: number | null = null;
    let resolveExit: ((code: number) => void) | undefined;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const finish = (code: number): void => {
      if (exitCode !== null) return;
      exitCode = code;
      closeStdout?.();
      resolveExit?.(code);
    };
    if (resident) finishCurrent = finish;
    else queueMicrotask(() => finish(turn.exitCode ?? 0));
    return {
      pid: 1000 + spawns.length,
      stdout,
      stderr,
      exited,
      get exitCode() {
        return exitCode;
      },
      signalCode: null,
      stdin: {
        write(chunk: string) {
          if (!withStdin) throw new Error('stdin 未开管道');
          record.stdinWrites.push(chunk);
          for (const line of turn.onFrame?.(chunk) ?? []) pushLine?.(line);
        },
        end() {
          record.stdinEnded = true;
        },
      },
    };
  };

  return {
    spawns,
    chownedPaths,
    finishResident: (exitCode = 0) => finishCurrent?.(exitCode),
    spawnPiped: (spec) => makeChild(spec, false),
    spawnWithStdin: (spec) => makeChild(spec, true),
    killTree: async (child: DriverChildProcess) => {
      finishCurrent?.(143);
      await Promise.resolve(child.pid);
    },
    pumpLines: async (stream, onLine) => {
      const decoder = new TextDecoder();
      let pending = '';
      for await (const chunk of stream) {
        pending += decoder.decode(chunk, { stream: true });
        let index = pending.indexOf('\n');
        while (index >= 0) {
          onLine(pending.slice(0, index));
          pending = pending.slice(index + 1);
          index = pending.indexOf('\n');
        }
      }
      if (pending.length > 0) onLine(pending);
    },
    chownToWorker: async (path) => {
      chownedPaths.push(path);
      await Promise.resolve();
    },
    which: options.which ?? (() => '/usr/bin/fake'),
  };
}

function streamOf(lines: readonly string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
      controller.close();
    },
  });
}
