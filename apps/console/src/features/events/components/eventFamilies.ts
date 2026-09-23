import type { EventTypeDto } from '@crewstation/contracts';

/** 一个事件族：`gitlab.issue` 与它的 `open`／`close`… 子类型；族名本身也可能是一个可订阅的类型。 */
export interface EventFamily {
  readonly name: string;
  /** 族名本身作为事件类型登记时的那一条。 */
  readonly self?: EventTypeDto;
  readonly leaves: readonly { readonly leaf: string; readonly type: EventTypeDto }[];
}

export interface EventProducerGroup { readonly producer: string; readonly families: readonly EventFamily[]; readonly count: number }

/** 按生产方分组、再按「生产方.族.子类型」归族；只列在用的类型，已下线的不再给人订阅。 */
export function groupEventTypes(items: readonly EventTypeDto[]): readonly EventProducerGroup[] {
  const producers = new Map<string, Map<string, { self?: EventTypeDto; leaves: { leaf: string; type: EventTypeDto }[] }>>();
  for (const type of items) {
    if (type.state !== 'active') continue;
    const families = producers.get(type.producer) ?? new Map();
    producers.set(type.producer, families);
    // 只在「生产方.族.子类型」这种命名下归族；名字不以生产方开头时不猜层级，整名就是一行。
    const rest = type.eventType.startsWith(`${type.producer}.`) ? type.eventType.slice(type.producer.length + 1) : '';
    const dot = rest.indexOf('.');
    const family = dot < 0 ? type.eventType : type.eventType.slice(0, type.eventType.length - rest.length + dot);
    const entry = families.get(family) ?? { leaves: [] };
    families.set(family, entry);
    if (dot < 0) entry.self = type; else entry.leaves.push({ leaf: rest.slice(dot + 1), type });
  }
  return [...producers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([producer, families]) => {
    const list = [...families.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([name, entry]) => ({ name, self: entry.self, leaves: [...entry.leaves].sort((a, b) => a.leaf.localeCompare(b.leaf)) }));
    return { producer, families: list, count: list.reduce((sum, family) => sum + family.leaves.length + (family.self ? 1 : 0), 0) };
  });
}

/** 粘进 crewstation.yaml `subscriptions:` 下的一项：Manifest 按 ID 绑定事件类型，注释写明是哪个类型；处理路径是建议值。 */
export function subscriptionSnippet(type: Pick<EventTypeDto, 'id' | 'eventType'>): string {
  return `- eventTypeId: ${type.id}  # ${type.eventType}\n  handlerPath: /events/${type.eventType.replaceAll('.', '-')}\n`;
}
