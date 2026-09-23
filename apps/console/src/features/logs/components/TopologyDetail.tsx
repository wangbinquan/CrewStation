// 项目侧的只读详情（RFC-019）：事实、关联（可点跳）、容器；管理动作仍只在集群管理里。
import type { ReactElement } from 'react';
import type { ClusterResource } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import type { OperationsSearch } from '../../../shared/project/operationsSearch';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import type { Topology } from '../../../shared/ui/topology/topologyModel';
import { statusTone } from '../../../shared/ui/topology/topologyModel';
import styles from './TopologyDetail.module.css';

/** 按节点用途推出日志页的来源筛选；推不出（入口、数据库）就不给日志入口。 */
export function logsSearchFor(resource: ClusterResource | undefined): OperationsSearch | undefined {
  if (!resource || resource.kind !== 'Pod') return undefined;
  if (resource.slotRole) return { tab: 'logs', source: 'slot', slot: resource.slotRole };
  if (resource.purpose.startsWith('development') && resource.taskId) return { tab: 'logs', source: 'dev-session', taskId: resource.parentTaskId ?? resource.taskId };
  if (resource.purpose.startsWith('business') && resource.taskId) return { tab: 'logs', source: 'business-task', taskId: resource.parentTaskId ?? resource.taskId };
  if ((resource.purpose === 'build' || resource.purpose === 'migration') && resource.releaseId) return { tab: 'logs', source: resource.purpose, releaseId: resource.releaseId };
  return undefined;
}

export function TopologyDetail({ topology, nodeId, resources, onSelect, onClose, onLogs }: { readonly topology: Topology; readonly nodeId: string; readonly resources: readonly ClusterResource[]; readonly onSelect: (id: string) => void; readonly onClose: () => void; readonly onLogs: (next: OperationsSearch) => void }): ReactElement | null {
  const t = useT();
  const node = topology.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const resource = resources.find((r) => r.resourceId === node.resourceId);
  const related = topology.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId).map((edge) => ({ edge, other: topology.nodes.find((n) => n.id === (edge.from === nodeId ? edge.to : edge.from)), outgoing: edge.from === nodeId })).filter((r) => r.other);
  const logs = logsSearchFor(resource);
  // 侧栏详情的操作一律在顶部（2026-09-23 作者裁定，RFC-019 修订说明）：详情很长时底部按钮够不着；不套用对象卡的底部操作条。
  return <Card title={node.title} extra={<Button variant="ghost" onClick={onClose}>{t('logs.topology.close')}</Button>} stacked>
    <p className={styles.line}><Badge tone={statusTone(node.status)}>{node.statusText ?? t(`topology.status.${node.status}`)}</Badge>{node.abnormal ? <Badge tone="warning">{t('logs.topology.attention')}</Badge> : null}<span>{t(`topology.semantic.${node.semantic}`)}{node.subtitle ? ` · ${node.subtitle}` : ''}</span></p>
    {logs ? <div className={styles.actions}><Button onClick={() => onLogs(logs)}>{t('logs.topology.viewLogs')}</Button></div> : null}
    <DefinitionList items={(node.facts ?? []).map(([label, value]) => ({ label, value }))} />
    {related.length > 0 ? <div><h3 className={styles.heading}>{t('logs.topology.related', { count: related.length })}</h3><ul className={styles.related}>{related.map(({ edge, other, outgoing }) => <li key={`${edge.from}-${edge.to}`}><button type="button" className={styles.row} onClick={() => onSelect(other!.id)}><strong>{other!.title}</strong><small>{outgoing ? '→ ' : '← '}{t(`topology.edge.${edge.kind}`)}{edge.label ? ` · ${edge.label}` : ''}</small></button></li>)}</ul></div> : null}
    {resource && resource.containers.length > 0 ? <div><h3 className={styles.heading}>{t('logs.topology.containers')}</h3><table className={styles.table}><thead><tr><th>{t('logs.topology.container')}</th><th>{t('logs.topology.image')}</th><th>{t('logs.topology.ready')}</th><th>{t('logs.topology.restarts')}</th><th>{t('logs.topology.state')}</th></tr></thead><tbody>{resource.containers.map((c) => <tr key={c.name}><td>{c.init ? `init · ${c.name}` : c.name}</td><td><code>{c.image}</code></td><td>{c.ready ? t('logs.topology.yes') : t('logs.topology.no')}</td><td>{c.restarts}</td><td>{c.reason ? `${c.state} · ${c.reason}` : c.state}</td></tr>)}</tbody></table></div> : null}
    <p className={styles.muted}>{t('logs.topology.readOnly')}</p>
  </Card>;
}
