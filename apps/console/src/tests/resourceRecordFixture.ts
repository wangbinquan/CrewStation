import type { ResourceRecord, ResourceStreamEvent, ResourceView } from '@crewstation/contracts';

/** RFC-025 标准资源记录的用例夹具：缺省是一个运行中的开发工作区。 */
export function resourceRecord(over: Partial<ResourceRecord> & { readonly id: string }): ResourceRecord {
  const time = '2026-09-23T12:00:00.000Z';
  return {
    kind: 'dev-workspace', owner: { module: 'task-runtime', ref: over.id }, phase: 'ready', phaseSince: time, conditions: [], children: [],
    generation: 1, observedGeneration: 1, actions: [], version: 1, createdAt: time, updatedAt: time, ...over,
  };
}

export function resourceView(items: readonly ResourceRecord[], cursor = 1): ResourceView {
  return { items: [...items], counts: {}, cursor };
}

/**
 * 假的 EventSource：用例里装到 globalThis 上，按地址记下打开的连接，由用例推帧、报错或关掉。
 * 与浏览器一样，`readyState` 2 表示连接已关闭、不会自己重连。
 */
export class FakeEventSource {
  static readonly opened: FakeEventSource[] = [];
  readyState = 1;
  onerror: ((event: Event) => void) | null = null;
  private readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.opened.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.readyState = 2;
  }

  emit(event: ResourceStreamEvent): void {
    this.emitRaw(event.type, JSON.stringify(event));
  }

  /** 原样推一帧（例如缺字段、不是 JSON 的坏帧）。 */
  emitRaw(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data }));
  }

  fail(closed: boolean): void {
    this.readyState = closed ? 2 : 0;
    this.onerror?.(new Event('error'));
  }

  static reset(): void {
    FakeEventSource.opened.length = 0;
  }
}
