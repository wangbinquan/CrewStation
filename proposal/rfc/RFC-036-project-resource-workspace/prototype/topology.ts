import type { Topology, TopologyNode } from '../../../../apps/console/src/shared/ui/topology/topologyModel';
import { CATEGORY_LABEL, edges, pendingFor, PENDING_STATES, REQUEST_LABEL } from './model';
import type { Category, Entry, ResourceRequest } from './model';
import { metricsFor } from './fields';

export function accessOf(entry: Entry, requests: ResourceRequest[]) {
  return entry.access !== 'owned' && pendingFor(requests, entry.id) ? 'pending' : entry.access;
}
export function matches(entry: Entry, requests: ResourceRequest[], category: string, access: string, search: string) {
  const state = accessOf(entry, requests);
  return (category === 'all' || category === entry.category)
    && (access === 'all' || access === state || (access === 'pending' && Boolean(pendingFor(requests, entry.id))))
    && `${entry.title} ${entry.summary} ${entry.source} ${entry.owner} ${entry.metrics.flat().join(' ')}`.toLowerCase().includes(search.toLowerCase());
}
function nodeFor(entry: Entry, requests: ResourceRequest[], partial: boolean): TopologyNode {
  const pending = pendingFor(requests, entry.id);
  const status = accessOf(entry, requests);
  const shortTitles: Record<string, string> = { service: '应用服务 · 双槽', agents: '标准算力 · Agent', volumes: '任务工作卷 · 2 个' };
  return { id: entry.id, title: shortTitles[entry.id] ?? entry.title, kind: entry.kind, semantic: entry.semantic, lane: entry.lane, row: entry.row, band: entry.category,
    status: partial && ['objects', 'namespace', 'volumes'].includes(entry.id) ? 'unknown' : entry.state,
    statusText: partial && ['objects', 'namespace', 'volumes'].includes(entry.id) ? '用量未知' : entry.stateText,
    subtitle: status === 'pending' ? '申请中 · 尚未生效' : status === 'requestable' ? '可以申请' : pending ? '已有 · 变更申请中' : entry.source,
    counts: metricsFor(entry, partial), facts: entry.facts,
  };
}
export function makeTopology(entries: Entry[], requests: ResourceRequest[], category: string, partial: boolean): Topology {
  const visible = entries.filter((entry) => category === 'all' || entry.category === category);
  const nodes = visible.map((entry) => nodeFor(entry, requests, partial));
  const links = edges.filter((edge) => nodes.some((n) => n.id === edge.from) && nodes.some((n) => n.id === edge.to)).map((edge) => edge.evidence === 'static' && entries.find((e) => e.id === edge.to)?.access === 'owned' ? { ...edge, label: '已授权 · 可选' } : edge);
  for (const request of requests.filter((r) => r.type === 'quota' && PENDING_STATES.includes(r.state))) {
    const entry = visible.find((e) => e.id === request.target);
    if (!entry) continue;
    const occupied = new Set(nodes.filter((n) => n.band === entry.category && n.lane === 3).map((n) => n.row ?? 0));
    let row = entry.row;
    while (occupied.has(row)) row += 1;
    nodes.push({ id: request.id, title: `${entry.title} · 变更`, kind: 'job', semantic: entry.semantic, lane: 3, row, band: entry.category,
      status: 'pending', statusText: REQUEST_LABEL[request.state], subtitle: request.id,
      counts: [['当前', request.before], [request.approvedAfter ? '批准' : '申请', request.approvedAfter ?? request.after], ['审批', '平台管理员']], facts: [['说明', request.reason]],
    });
    links.push({ from: entry.id, to: request.id, kind: 'control', label: '待生效', evidence: 'static' });
  }
  const categories = [...new Set(visible.map((entry) => entry.category))];
  const semantics = { production: 'service', execution: 'business', integration: 'security', foundation: 'platform' } as const;
  return { id: 'orders-resources', title: '订单协作助手 · 项目资源全景', lanes: ['01  归属与约束', '02  消费方与实例', '03  已有能力', '04  扩展与申请'],
    bands: categories.map((id: Category) => ({ id, title: CATEGORY_LABEL[id], semantic: semantics[id], note: `${visible.filter((e) => e.category === id).length} 项` })),
    nodes, edges: links, observedAt: '2026-09-30T02:45:00Z', complete: !partial,
  };
}
