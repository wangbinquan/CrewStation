// RFC-025 标准资源视图在工作台缓存里的形态：快照＋推送流的增量合进同一份视图，游标随之前进。纯函数。
import type { ResourceRecord, ResourceStreamEvent, ResourceView } from '@crewstation/contracts';

/**
 * 把推送流的一个事件合进视图。`reset` 要求重读快照，返回 undefined；心跳原样返回。
 * 同一条记录只接受版本不低于已有的（重连补发与快照交错时，旧版本不覆盖新版本）；游标只进不退。
 */
export function applyResourceEvent(view: ResourceView, event: ResourceStreamEvent): ResourceView | undefined {
  switch (event.type) {
    case 'snapshot': return { items: event.items, counts: event.counts, cursor: event.cursor };
    case 'upsert': {
      const cursor = Math.max(view.cursor, event.cursor), at = view.items.findIndex((item) => item.id === event.record.id);
      if (at >= 0 && view.items[at]!.version > event.record.version) return { ...view, cursor };
      const items = at >= 0 ? view.items.map((item, index) => (index === at ? event.record : item)) : [...view.items, event.record];
      return { items, counts: event.counts, cursor };
    }
    case 'remove': return { items: view.items.filter((item) => item.id !== event.id), counts: event.counts, cursor: Math.max(view.cursor, event.cursor) };
    case 'heartbeat': return view;
    case 'reset': return undefined;
  }
}

/** 某个终端（CLI）对应的 Agent 执行记录：按展示字段 `terminal` 对上；同一终端有多条时取最新建的一条。 */
export function terminalRecord(records: readonly ResourceRecord[], terminalId: string): ResourceRecord | undefined {
  return records.filter((record) => record.kind === 'agent-execution' && record.display?.terminal === terminalId)
    .reduce<ResourceRecord | undefined>((latest, record) => (!latest || record.createdAt > latest.createdAt ? record : latest), undefined);
}
