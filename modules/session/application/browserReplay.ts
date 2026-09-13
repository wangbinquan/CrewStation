import type { TaskId } from '@crewstation/contracts';
import type { EventSink } from '../domain/runnerConnection';
import { RunnerConnection } from '../domain/runnerConnection';
import { browserReplayBuffer } from '../domain/browserReplayBuffer';
import type { SessionUseCaseDeps } from './dependencies';
import type { RunnerHub } from './runnerHub';

/** 先订阅再查库。单次历史有界；未补齐时只回放这一页，并显式要求客户端从该游标续接。 */
export async function openBrowserReplay(deps: SessionUseCaseDeps, hub: RunnerHub, taskId: TaskId, sink: EventSink, sinceSeq: number) {
  const bridge = browserReplayBuffer(sink);
  const unsubscribe = hub.subscribe(taskId, bridge);
  try {
    const limit = Math.max(1, Math.min(5000, deps.settings.replayLimit));
    const items = await deps.events.listSince(taskId, sinceSeq, { limit: limit + 1 });
    const replay = items.slice(0, limit);
    const complete = items.length <= limit && !bridge.overflow;
    const frames = replay.map((e) => RunnerConnection.frameOf(e.seq, e.at.toISOString(), e.event));
    if (complete) bridge.flush(frames, sinceSeq);
    else { unsubscribe(); for (const frame of frames) sink.send(frame); }
    sink.send(JSON.stringify({
      type: 'streamReady', connected: complete && hub.connections.has(taskId), replayed: replay.length,
      replayComplete: complete, ...(!complete ? { resumeFromSeq: replay.at(-1)?.seq ?? sinceSeq } : {}),
    }));
    return { complete, unsubscribe };
  } catch (error) { unsubscribe(); throw error; }
}
