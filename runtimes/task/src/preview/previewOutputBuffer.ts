import { PREVIEW_LOG_LIMITS } from '@crewstation/contracts';
import type { PreviewLogLine } from '@crewstation/contracts';

/**
 * 预览进程输出的有界环形缓冲（RFC-016）。只在内存里，随容器生灭。
 *
 * 跨重启**不清空**：崩溃前那一次运行的输出正是要看的东西，清掉等于把证据删了；
 * 每行带 `attempt` 供调用方区分是哪一次运行。
 *
 * 不做脱敏：`buildChildEnv` 已经把 `CS_RUNNER_TOKEN`／`CS_SESSION_URL` 从所有子进程环境里剔除，
 * 预览进程能打印的只剩项目自己的配置，而能读这份缓冲的 owner／developer／admin
 * 本来就能在同一容器的终端里读到它们（tester 只有 `view-preview`，够不到这里）。
 */
export interface PreviewOutputBuffer {
  /** 写入一行（不含换行符）；超过单行上限按字节截断并标记。 */
  push(stream: 'stdout' | 'stderr', text: string, attempt: number): void;
  read(query: { limit: number; stream?: 'stdout' | 'stderr' }): { lines: PreviewLogLine[]; dropped: number };
}

export interface PreviewOutputBufferDeps {
  now?: () => Date;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createPreviewOutputBuffer(deps: PreviewOutputBufferDeps = {}): PreviewOutputBuffer {
  const now = deps.now ?? (() => new Date());
  const lines: PreviewLogLine[] = [];
  const sizes: number[] = [];
  let bytes = 0;
  let dropped = 0;

  const evictWhileOver = (): void => {
    while (lines.length > PREVIEW_LOG_LIMITS.maxLines || bytes > PREVIEW_LOG_LIMITS.maxBytes) {
      // 缓冲永远非空时才进这里，但 maxBytes 小于单行上限的构造下仍要守住，避免死循环。
      if (lines.length === 0) break;
      lines.shift();
      bytes -= sizes.shift() ?? 0;
      dropped += 1;
    }
  };

  return {
    push(stream, text, attempt) {
      const clamped = clampLine(text);
      const size = encoder.encode(clamped.text).length;
      lines.push({
        at: now().toISOString(),
        stream,
        attempt,
        text: clamped.text,
        ...(clamped.truncated ? { truncated: true } : {}),
      });
      sizes.push(size);
      bytes += size;
      evictWhileOver();
    },
    read(query) {
      const matched = query.stream === undefined ? lines : lines.filter((line) => line.stream === query.stream);
      // 取尾部：要看的是最近发生了什么，不是容器刚起来时打了什么。
      return { lines: matched.slice(-query.limit), dropped };
    },
  };
}

/**
 * 按**字节**截到单行上限。先按字节切，再用非严格解码把被切开的多字节字符收成 U+FFFD 并去掉，
 * 免得返回半个字符破坏调用方的 JSON。
 */
function clampLine(text: string): { text: string; truncated: boolean } {
  const encoded = encoder.encode(text);
  if (encoded.length <= PREVIEW_LOG_LIMITS.maxLineBytes) return { text, truncated: false };
  const cut = decoder.decode(encoded.subarray(0, PREVIEW_LOG_LIMITS.maxLineBytes)).replace(/�+$/u, '');
  return { text: cut, truncated: true };
}
