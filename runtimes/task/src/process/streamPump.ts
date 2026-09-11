/** 单个输出帧的文本上限：避免一次 stdout 突发变成超大 WebSocket 帧。 */
export const MAX_CHUNK_CHARS = 32 * 1024;

/** 把字节流按 UTF-8 流式解码（多字节字符跨块不撕裂）并切成有界文本块交给回调。 */
export async function pumpStream(stream: ReadableStream<Uint8Array>, onText: (text: string) => void): Promise<void> {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  for await (const chunk of stream) {
    for (const piece of splitChunk(decoder.decode(chunk, { stream: true }))) onText(piece);
  }
  const rest = decoder.decode();
  if (rest.length > 0) onText(rest);
}

export function splitChunk(text: string, max = MAX_CHUNK_CHARS): string[] {
  if (text.length === 0) return [];
  if (text.length <= max) return [text];
  const pieces: string[] = [];
  for (let start = 0; start < text.length; start += max) pieces.push(text.slice(start, start + max));
  return pieces;
}

/** 行切分器：把任意分块的文本重组为完整行（尾部无换行的一段在 flush 时交出）。 */
export function createLineSplitter(onLine: (line: string) => void, maxLineChars = 8 * 1024): { push(text: string): void; flush(): void } {
  let pending = '';
  return {
    push(text) {
      pending += text;
      let index = pending.indexOf('\n');
      while (index >= 0) {
        onLine(pending.slice(0, index).slice(0, maxLineChars));
        pending = pending.slice(index + 1);
        index = pending.indexOf('\n');
      }
      if (pending.length > maxLineChars) {
        onLine(pending.slice(0, maxLineChars));
        pending = '';
      }
    },
    flush() {
      if (pending.length > 0) onLine(pending.slice(0, maxLineChars));
      pending = '';
    },
  };
}
