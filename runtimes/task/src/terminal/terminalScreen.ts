import { createRequire } from 'node:module';
import type { ITerminalAddon } from '@xterm/headless';
import type * as XtermHeadless from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';

// 6.0.0 的 module 字段指向缺失的文件；官方 main 是有效的 CJS 入口。
const { Terminal } = createRequire(import.meta.url)('@xterm/headless') as typeof XtermHeadless;
export const TERMINAL_SCROLLBACK_LIMIT = 500;
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

/** 模拟完整 ANSI 状态后序列化，不把有界原始字节尾部当成可恢复屏幕。 */
export function createTerminalScreen(cols: number, rows: number) {
  const terminal = new Terminal({ cols, rows, scrollback: TERMINAL_SCROLLBACK_LIMIT, allowProposedApi: true });
  const serialize = new SerializeAddon();
  terminal.loadAddon(serialize as unknown as ITerminalAddon);
  let tail: Promise<void> = Promise.resolve();
  let throughSeq = 0;
  let truncated = false;
  const marker = terminal.registerMarker(0);
  marker?.onDispose(() => { truncated = true; });
  return {
    write(data: string, seq: number): Promise<void> {
      tail = tail.then(() => new Promise<void>((resolve) => terminal.write(data, () => { throughSeq = seq; resolve(); })));
      return tail;
    },
    resize(nextCols: number, nextRows: number): Promise<void> {
      tail = tail.then(() => { terminal.resize(nextCols, nextRows); });
      return tail;
    },
    async snapshot() {
      await tail;
      let data = serialize.serialize();
      let clipped = truncated;
      if (Buffer.byteLength(data) > MAX_SNAPSHOT_BYTES) { data = serialize.serialize({ scrollback: 0 }); clipped = true; }
      return { data, throughSeq, cols: terminal.cols, rows: terminal.rows, truncated: clipped, scrollbackLimit: TERMINAL_SCROLLBACK_LIMIT };
    },
    async dispose(): Promise<void> { await tail; terminal.dispose(); },
  };
}
