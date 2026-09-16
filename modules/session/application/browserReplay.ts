import type { TaskId } from '@crewstation/contracts';
import type { EventSink } from '../domain/runnerConnection';
import { RunnerConnection } from '../domain/runnerConnection';
import { browserReplayBuffer } from '../domain/browserReplayBuffer';
import type { SessionUseCaseDeps } from './dependencies';
import type { RunnerHub } from './runnerHub';

export interface BrowserReplayOptions {
  /**
   * 首次打开（sinceSeq=0）只回放最近一页：终端画面按快照恢复，名册与动态各有持久查询，
   * 逐页拉回几万条历史只会让工作台长时间停在“连接中”。续接（sinceSeq>0）仍按游标补齐，不留缺口。
   */
  readonly tail?: boolean;
}

/** 先订阅再查库。单次历史有界；未补齐时只回放这一页，并显式要求客户端从该游标续接。 */
export async function openBrowserReplay(deps: SessionUseCaseDeps, hub: RunnerHub, taskId: TaskId, sink: EventSink, sinceSeq: number, options: BrowserReplayOptions = {}) {
  const bridge = browserReplayBuffer(sink);
  const unsubscribe = hub.subscribe(taskId, bridge);
  try {
    const limit = Math.max(1, Math.min(5000, deps.settings.replayLimit));
    const from = options.tail && sinceSeq === 0 ? Math.max(0, (await deps.events.maxSeq(taskId)) - limit) : sinceSeq;
    const items = await deps.events.listSince(taskId, from, { limit: limit + 1 });
    const replay = items.slice(0, limit);
    const complete = items.length <= limit && !bridge.overflow;
    const frames = replay.map((e) => RunnerConnection.frameOf(e.seq, e.at.toISOString(), e.event));
    if (complete) bridge.flush(frames, from);
    else { unsubscribe(); for (const frame of frames) sink.send(frame); }
    sink.send(JSON.stringify({
      type: 'streamReady', connected: complete && hub.connections.has(taskId), replayed: replay.length,
      replayComplete: complete, ...(from > sinceSeq ? { replayFromSeq: from } : {}), ...(!complete ? { resumeFromSeq: replay.at(-1)?.seq ?? from } : {}),
    }));
    return { complete, unsubscribe };
  } catch (error) { unsubscribe(); throw error; }
}
