import { useEffect, useState } from 'react';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { PageHeader } from '../../../../apps/console/src/shared/ui/PageHeader';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { DataTable } from '../../../../apps/console/src/shared/ui/DataTable';
import { Segmented } from '../../../../apps/console/src/shared/ui/Segmented';
import { ActionRow } from '../../../../apps/console/src/shared/ui/ActionRow';
import { CreationDialog } from './CreationDialog';
import { DeletionDialog } from './DeletionDialog';
import { PROJECTS, initialDraft } from './model';

export function App() {
  const [mode, setMode] = useState('admin'), [theme, setTheme] = useState('light'), [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(initialDraft), [target, setTarget] = useState<readonly string[]>(), [query, setQuery] = useState('');
  useEffect(() => { document.documentElement.dataset.demoTheme = theme; }, [theme]);
  const admin = mode === 'admin', rows = PROJECTS.filter((project) => `${project[0]} ${project[1]}`.includes(query));
  return <div className="demo-shell">
    <div className="review-bar"><div><Badge tone="info">RFC-037 交互稿</Badge><span>演示数据 · 不创建或删除真实项目</span></div>
      <ActionRow><Segmented label="预览身份" value={mode} onChange={setMode} items={[{ value: 'admin', label: '管理员代建' }, { value: 'self', label: '开发者自建' }]} />
        <Button variant="ghost" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? '深色' : '浅色'}</Button></ActionRow>
    </div>
    <aside className="demo-sidebar"><div className="demo-brand"><span>C</span><strong>CrewStation</strong></div><div className="workspace-caption">项目与能力供给</div><div className="demo-nav active">项目管理</div><div className="demo-nav">能力接入</div><div className="workspace-caption">运行与观测</div><div className="demo-nav">运行概览</div><div className="demo-nav">集群管理</div><div className="demo-profile"><span>管</span><div><strong>平台管理员</strong><small>本地交互预览</small></div></div></aside>
    <main className="demo-main"><div className="breadcrumb">{admin ? '平台管理' : '我的工作台'} <span>／</span> {admin ? '项目管理' : '我的项目'}</div>
      <PageHeader title={admin ? '项目管理' : '我的项目'} description="从项目开始开发、验收和上线你的数字人应用。" actions={<Button variant="primary" onClick={() => setCreating(true)}>＋ 新建项目</Button>} />
      <div className="list-toolbar"><label>搜索项目<input type="search" value={query} placeholder="名称或域名标识" onChange={(event) => setQuery(event.target.value)} /></label><span>{rows.length} 个项目</span></div>
      <Card compact><DataTable columns={admin ? ['项目', '负责人', '状态', '操作'] : ['项目', '负责人', '状态']}>
        {rows.map(([name, slug, purpose, owner]) => <tr key={slug}><td><div className="project-cell"><span className="project-icon">{name.slice(0, 1)}</span><div><strong>{name}</strong><p>{purpose}</p><code>{slug}</code></div></div></td><td>{owner}</td><td><Badge tone="success">运行中</Badge></td>{admin ? <td><Button variant="danger" size="small" onClick={() => setTarget([name, slug])}>删除项目</Button></td> : null}</tr>)}
      </DataTable></Card>
    </main>
    {creating ? <CreationDialog draft={draft} setDraft={setDraft} admin={admin} onClose={() => setCreating(false)} /> : null}
    {target ? <DeletionDialog name={target[0]!} slug={target[1]!} onClose={() => setTarget(undefined)} /> : null}
  </div>;
}
