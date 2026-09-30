import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Badge, Button, PageHeader } from './ui';
import type { Workspace } from './useWorkspace';
import type { ViewRole } from './model';
import { PENDING_STATES } from './model';

export function Shell({ ws, children }: { ws: Workspace; children: ReactNode }) {
  const admin = ws.role === 'admin';
  const [theme, setTheme] = useState('light');
  useEffect(() => { document.documentElement.dataset.demoTheme = theme; }, [theme]);
  return <div className="prototype-shell">
    <div className="review-bar"><div><b>DESIGN / 036</b><span>项目资源中心 · 交互原型</span><Badge>示例数据</Badge></div><div className="review-controls"><label>预览身份 <select aria-label="预览身份" value={ws.role} onChange={(e) => { ws.setRole(e.target.value as ViewRole); ws.setSelected(undefined); ws.setCatalog(undefined); }}><option value="owner">项目负责人</option><option value="developer">开发者 · 只读</option><option value="admin">平台管理员</option></select></label><label className="scenario-control">演示场景 <select aria-label="演示场景" value={ws.scenario} onChange={(e) => ws.setScenario(e.target.value)}><option value="normal">正常数据</option><option value="partial">部分采集不可用</option><option value="conflict">审批配置冲突</option><option value="failure">生效失败</option></select></label><Button variant="ghost" size="small" aria-label="切换深浅主题" onClick={() => setTheme((t) => t === 'light' ? 'dark' : 'light')}>◐</Button><Button variant="ghost" size="small" onClick={ws.reset}>重置示例</Button></div></div>
    <aside className="sidebar"><div className="brand"><span>◈</span> CrewStation</div><div className="section-caption">{admin ? '平台管理' : '项目管理'}</div><div className="side-project"><span className="project-icon">订</span><div><strong>订单协作助手</strong><small>orders-assistant</small></div></div><div className="side-menu"><span>◫　项目概览</span><span className="active">▦　资源中心 <b>NEW</b></span><span>◉　运行观测</span><span>◇　服务与发布</span><span>⌘　开发工作台</span><span>☷　业务任务</span><span>♧　项目成员</span></div><div className="sidebar-foot"><span className="avatar">{admin ? '李' : '张'}</span><div><strong>{admin ? '李悦' : ws.role === 'owner' ? '张明' : '陈晨'}</strong><small>{admin ? '平台管理员' : ws.role === 'owner' ? '项目负责人' : '项目开发者'}</small></div></div></aside>
    <main className="main"><div className="breadcrumb"><span>{admin ? '平台管理 / 项目管理' : '项目管理'}</span><span>/</span><span>订单协作助手</span><span>/</span><b>资源中心</b><span className="snapshot">自动更新 · 10:45:00</span></div>{children}</main>
  </div>;
}
export function ResourceHeader({ ws }: { ws: Workspace }) {
  const admin = ws.role === 'admin';
  return <div className="resource-header"><PageHeader title="项目资源中心" description="从资源全景到授权、配额和变更，掌握项目的每一项能力。" actions={ws.role !== 'developer' ? <><Button variant="primary" onClick={() => ws.setCatalog('grant')}>＋ {admin ? '分配资源' : '申请资源'}</Button><Button variant="secondary" onClick={() => ws.setCatalog('quota')}>{admin ? '调整配额' : '申请配额变更'}</Button></> : <Badge>开发者 · 查看权限</Badge>} /><div className="role-note"><span className={`state-dot ${admin ? 'requestable' : 'owned'}`} />{admin ? '平台管理视角 · 本页直接分配、调整配额和审批项目申请' : ws.role === 'owner' ? '项目负责人视角 · 可申请资源与配额变更，由平台管理员审批' : '开发者视角 · 资源变更请由项目负责人张明发起'}</div></div>;
}
export function Summary({ ws, showRequests }: { ws: Workspace; showRequests: () => void }) {
  const execution = ws.entries.find((e) => e.id === 'execution-quota')!, objects = ws.entries.find((e) => e.id === 'objects')!, namespace = ws.entries.find((e) => e.id === 'namespace')!;
  const partial = ws.scenario === 'partial', pending = ws.requests.filter((r) => PENDING_STATES.includes(r.state));
  const stats = [{ id: execution.id, label: '执行并发', value: `5 / ${execution.quota?.limit}`, unit: '个', caption: '开发 1 · 业务 2 · Agent 2', percent: 5 / execution.quota!.limit * 100 },
    { id: namespace.id, label: 'CPU 请求总量', value: partial ? '未知' : `3.5 / ${namespace.quota?.limit}`, unit: partial ? '' : '核', caption: partial ? `采集暂不可用 · 配额仍为 ${namespace.quota?.limit} 核` : '项目空间共享 · 非实时消耗', percent: partial ? 0 : 3.5 / namespace.quota!.limit * 100 },
    { id: objects.id, label: '对象存储', value: partial ? '未知' : `13.6 / ${objects.quota?.limit}`, unit: partial ? '' : 'GiB', caption: partial ? '采集暂不可用 · 保留最后策略' : '已用 12.4 + 预留 1.2 GiB', percent: partial ? 0 : 13.6 / objects.quota!.limit * 100 }];
  return <div className="summary-grid">{stats.map((s) => <button className="stat-card" key={s.id} onClick={() => ws.setSelected(s.id)}><span className="stat-label">{s.label}<span>↗</span></span><strong>{s.value}<small>{s.unit}</small></strong><div className="usage-track"><span style={{ width: `${s.percent}%` }} /></div><span className="stat-caption">{s.caption}</span></button>)}<button className="stat-card pending-card" onClick={showRequests}><span className="stat-label">{ws.role === 'admin' ? '待处理申请' : '进行中的申请'}<span>↗</span></span><strong>{pending.length}<small>项</small></strong><div className="pending-progress"><span />{pending.filter((r) => r.type === 'grant').length} 项资源 · {pending.filter((r) => r.type === 'quota').length} 项配额</div><span className="stat-caption">{ws.role === 'admin' ? '打开申请，在本页完成审批' : '批准并生效前，当前配置不变'}</span></button></div>;
}
