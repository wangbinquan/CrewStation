import type { K8sObject, WatchEventType } from './resources';

/** 解析 watch 的 NDJSON 流，直到服务端关闭或调用方中止。 */
export async function readWatchStream<T extends K8sObject>(res: Response, onEvent: (type: WatchEventType, obj: T) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          const event = JSON.parse(line) as { type: WatchEventType; object: T };
          onEvent(event.type, event.object);
        }
        newline = buffer.indexOf('\n');
      }
    }
  } catch (error) {
    if ((error as { name?: string }).name !== 'AbortError') throw error;
  }
}
