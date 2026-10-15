// 运行与诊断「部署与运行形态」页签（RFC-019）：项目范围只读盘点＋槽＋开发会话＋数据资源组装成图；15 秒轮询、换快照不卸载。
// RFC-025：开发会话、CLI 与业务任务改读资源台账（快照＋推送流），关掉的 CLI、释放的会话随推送立即从图上消失。
import { useState } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import type { OperationsSearch } from '../../../shared/project/operationsSearch';
import { useProjectTopology } from '../../../shared/topology/useProjectTopology';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { TopologyWorkspace } from '../../../shared/ui/topology/TopologyWorkspace';
import { TopologyDetail } from '../components/TopologyDetail';

export function TopologyPage({ projectId, onLogs }: { readonly projectId: string; readonly onLogs: (next: OperationsSearch) => void }): ReactElement {
  const t = useT(), [selected, setSelected] = useState<string>();
  const { topology, error, isPending, resources, truncated } = useProjectTopology(projectId);
  return <>
    <QueryStatus isPending={isPending} error={error} isEmpty={topology !== undefined && topology.nodes.length === 0} emptyTitle={t('logs.topology.emptyTitle')} emptyDescription={t('logs.topology.emptyDescription')} />
    {topology && topology.nodes.length > 0 ? <TopologyWorkspace topology={topology} label={topology.title} selectedId={selected} onSelect={setSelected}
      before={truncated ? <p>{t('logs.topology.truncated')}</p> : undefined}
      detail={selected ? <TopologyDetail topology={topology} nodeId={selected} resources={resources} onSelect={setSelected} onClose={() => setSelected(undefined)} onLogs={onLogs} /> : undefined} /> : null}
  </>;
}
