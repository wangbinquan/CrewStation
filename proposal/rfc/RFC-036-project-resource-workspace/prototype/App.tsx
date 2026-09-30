import { useState } from 'react';
import { Button, Tabs } from './ui';
import { useWorkspace } from './useWorkspace';
import { Shell, ResourceHeader, Summary } from './Shell';
import { ResourceFilters, ResourceGraph, ResourceList } from './ResourceView';
import type { Filters } from './ResourceView';
import { CatalogDialog, ChangeDialog, DetailDialog } from './ResourceDialogs';
import { RequestDialog, RequestList } from './RequestViews';
import { PENDING_STATES } from './model';

export function App() {
  const ws = useWorkspace();
  const [tab, setTab] = useState(() => window.innerWidth < 800 ? 'list' : 'topology');
  const [filters, setFilters] = useState<Filters>({ category: 'all', access: 'all', search: '' });
  const entry = ws.entries.find((e) => e.id === ws.selected), changing = ws.entries.find((e) => e.id === ws.changing);
  const request = ws.requests.find((r) => r.id === ws.requestId);
  const attention = /失败|冲突|未覆盖/.test(ws.message);
  return <Shell ws={ws}>
    <ResourceHeader ws={ws} /><Summary ws={ws} showRequests={() => setTab('requests')} />
    {ws.scenario === 'partial' ? <div className="notice warning compact-notice">部分用量采集暂不可用。授权和当前策略仍可查看；未知用量不计为 0。</div> : null}
    <section className="workspace"><Tabs label="项目资源视图" fill value={tab} onChange={setTab} items={[{ value: 'topology', label: '资源拓扑' }, { value: 'list', label: '资源清单' }, { value: 'requests', label: <>申请与变更 <span className="count-badge">{ws.requests.filter((r) => PENDING_STATES.includes(r.state)).length}</span></> }]} extra={<span className="view-note">同一项目 · 同一份资源</span>}>
      {tab === 'requests' ? <RequestList ws={ws} /> : <><ResourceFilters ws={ws} filters={filters} onChange={setFilters} />{tab === 'topology' ? <ResourceGraph ws={ws} filters={filters} /> : <ResourceList ws={ws} filters={filters} />}</>}
    </Tabs></section>
    {ws.message ? <div className="toast" role={attention ? 'alert' : 'status'}><span>{attention ? '!' : '✓'}</span>{ws.message}<Button variant="ghost" size="small" aria-label="关闭提示" onClick={() => ws.setMessage('')}>×</Button></div> : null}
    {entry ? <DetailDialog entry={entry} ws={ws} /> : null}
    {ws.catalog && ws.role !== 'developer' ? <CatalogDialog ws={ws} /> : null}
    {changing && ws.role !== 'developer' ? <ChangeDialog key={changing.id} entry={changing} ws={ws} /> : null}
    {request ? <RequestDialog key={request.id} request={request} ws={ws} /> : null}
  </Shell>;
}
