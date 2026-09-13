import type { EventSink } from './runnerConnection';

/** 回放期间只暂存实时帧；有界溢出要求重连续接，不能跨过缺口推进浏览器游标。 */
export function browserReplayBuffer(sink: EventSink) {
  const frames: string[] = [];
  let bytes = 0;
  let live = false;
  let overflow = false;
  return {
    send(frame: string) {
      if (live) { sink.send(frame); return; }
      if (overflow) return;
      bytes += Buffer.byteLength(frame);
      if (frames.length >= 1024 || bytes > 4 * 1024 * 1024) { overflow = true; frames.length = 0; return; }
      frames.push(frame);
    },
    get overflow() { return overflow; },
    /** 无 await：合并、发送与切到实时模式在同一事件循环中完成。 */
    flush(replay: string[], sinceSeq: number) {
      const events = new Map<number, string>();
      const metadata: string[] = [];
      for (const frame of [...replay, ...frames]) {
        const value = JSON.parse(frame) as { type: string; seq?: number };
        if (value.type !== 'event') { metadata.push(frame); continue; }
        if (typeof value.seq === 'number' && value.seq > sinceSeq && !events.has(value.seq)) events.set(value.seq, frame);
      }
      for (const [, frame] of [...events].sort(([a], [b]) => a - b)) sink.send(frame);
      for (const frame of metadata) sink.send(frame);
      frames.length = 0;
      live = true;
    },
  };
}
