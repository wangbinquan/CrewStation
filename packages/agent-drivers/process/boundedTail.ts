// ← agent-workflow `execution/managedProcess.ts` 的 `appendBounded` ／
// `MANAGED_PROCESS_MAX_STREAM_CHARS` 段（滚动尾部）。
// 宿主的 streamPump.ts 只管「解码 + 切行 + 单行上限」，没有「整条流的滚动尾部」这一层，
// 而 opencode 的 session-not-found 判定与失败时的 error 文案都要读 stderr 尾部，所以这一小段必须复制。

/** stderr 滚动尾部上限；源为 8 MiB，这里收到 64 KiB —— 尾部只用于报错与会话判定，不落库。 */
export const MAX_STDERR_TAIL_CHARS = 64 * 1024;

/** 有界尾部缓冲：只保留最后 N 个字符，前面的丢弃。 */
export function createBoundedTail(max = MAX_STDERR_TAIL_CHARS): { append(text: string): void; readonly text: string } {
  let buffer = '';
  return {
    append(text) {
      if (text.length === 0) return;
      buffer = buffer.length + text.length <= max ? buffer + text : (buffer + text).slice(-max);
    },
    get text() {
      return buffer;
    },
  };
}
