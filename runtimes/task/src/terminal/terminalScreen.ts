import { createRequire } from 'node:module';
import type * as XtermHeadless from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';
import { terminalSnapshotView } from './terminalSnapshotView';

// 6.0.0 的 module 字段指向缺失的文件；官方 main 是有效的 CJS 入口。
const { Terminal } = createRequire(import.meta.url)('@xterm/headless') as typeof XtermHeadless;
export const TERMINAL_SCROLLBACK_LIMIT = 500;
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

/** 模拟完整 ANSI 状态后序列化，不把有界原始字节尾部当成可恢复屏幕。 */
export function createTerminalScreen(cols: number, rows: number) {
  const terminal = new Terminal({ cols, rows, scrollback: TERMINAL_SCROLLBACK_LIMIT, allowProposedApi: true });
  const mouseEncoding = trackMouseEncoding(terminal);
  const serialize = new SerializeAddon();
  terminal.loadAddon({
    activate: () => serialize.activate(terminalSnapshotView(terminal) as unknown as Parameters<SerializeAddon['activate']>[0]),
    dispose: () => serialize.dispose(),
  });
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
    resize(nextCols: number, nextRows: number, seq?: number): Promise<void> {
      tail = tail.then(() => { terminal.resize(nextCols, nextRows); if (seq !== undefined) throughSeq = seq; });
      return tail;
    },
    async snapshot() {
      await tail;
      let data = serialize.serialize();
      let clipped = truncated;
      if (Buffer.byteLength(data) > MAX_SNAPSHOT_BYTES) { data = serialize.serialize({ scrollback: 0 }); clipped = true; }
      return { data: data + mouseEncoding.serialize(), throughSeq, cols: terminal.cols, rows: terminal.rows, truncated: clipped, scrollbackLimit: TERMINAL_SCROLLBACK_LIMIT };
    },
    /** RFC-024：当前活动缓冲区（普通或备用屏）视口里的非空白字符数，判定 CLI 界面是否画出用。 */
    async visibleChars(): Promise<number> {
      await tail;
      const buffer = terminal.buffer.active;
      let count = 0;
      for (let row = buffer.viewportY; row < buffer.viewportY + terminal.rows; row++) count += buffer.getLine(row)?.translateToString(true).replace(/\s/g, '').length ?? 0;
      return count;
    },
    async dispose(): Promise<void> { await tail; mouseEncoding.dispose(); terminal.dispose(); },
  };
}

/** addon-serialize 0.14 只保存鼠标 tracking，遗漏 SGR 编码；观察已解析的模式，不能查询写入尚未结束的 ANSI 流。 */
function trackMouseEncoding(terminal: XtermHeadless.Terminal) {
  let mode = 0;
  const handlers = [
    ...(['h', 'l'] as const).map((final) => terminal.parser.registerCsiHandler({ prefix: '?', final }, (params) => {
      for (const param of params) if (param === 1006 || param === 1016) mode = final === 'h' ? param : 0;
      return false;
    })),
    terminal.parser.registerEscHandler({ final: 'c' }, () => { mode = 0; return false; }),
  ];
  return {
    serialize: () => `\x1b[?${mode || 1006}${mode ? 'h' : 'l'}`,
    dispose: () => { for (const handler of handlers) handler.dispose(); },
  };
}
