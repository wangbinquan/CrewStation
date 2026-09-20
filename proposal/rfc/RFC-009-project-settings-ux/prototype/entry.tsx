import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { FormField } from '../../../../apps/console/src/shared/ui/FormField';
import { ConfirmationPanel } from '../../../../apps/console/src/shared/ui/ConfirmationPanel';
import { PageHeader } from '../../../../apps/console/src/shared/ui/PageHeader';
import { GlyphIcon } from '../../../../apps/console/src/shared/ui/icons/GlyphIcon';
import { ConfigDemo } from './ConfigDemo';
import { SettingsDemo } from './SettingsDemo';
import { ResourceDemo } from './ResourceDemo';
import '../../../../apps/console/src/app/theme/tokens.css';
import '../../../../apps/console/src/app/theme/base.css';
import './prototype.css';

export type DemoRole = 'developer' | 'owner' | 'admin';
const roles = { developer: '项目开发者', owner: '项目负责人', admin: '平台管理员' };
const reviewMode = new URLSearchParams(window.location.search).get('review') === '1';
const groups = {
  config: ['环境变量', '应用运行参数与密钥'], visibility: ['应用展示', '用途、图标与可见范围'],
  members: ['成员与角色', '谁参与开发和试用'], advanced: ['高级', '项目状态与归档'],
  api: ['API 接口', '文档、申请与试调'], events: ['事件', '事件类型与订阅'], data: ['数据与存储', '连接变量与访问方式'],
  project: ['项目与仓库', '地址、代码与资源额度'], guide: ['平台接入', '身份、环境变量与 MCP'],
};
type Group = keyof typeof groups;
function App() {
  const [area, setArea] = useState('settings'), [group, setGroup] = useState<Group>('config');
  const [role, setRole] = useState<DemoRole>('developer'), [fail, setFail] = useState(false);
  const [dirty, setDirty] = useState(false), [pending, setPending] = useState<(() => void)>();
  const [notice, setNotice] = useState('');
  const move = (nextArea: string, nextGroup: Group) => {
    if (area === nextArea && group === nextGroup) return;
    const apply = () => { setArea(nextArea); setGroup(nextGroup); setNotice(''); setDirty(false); };
    if (dirty) setPending(() => apply); else apply();
  };
  const switchRole = (next: DemoRole) => {
    const apply = () => { setRole(next); setDirty(false); };
    if (dirty) setPending(() => apply); else apply();
  };
  const items = area === 'settings' ? ['config', 'visibility', 'members', 'advanced'] as Group[] : ['api', 'events', 'data', 'project', 'guide'] as Group[];
  return <>
    <header className="topbar"><div className="brand"><GlyphIcon name="station" /><strong>CrewStation</strong><span className="projectName">／演示数字人</span></div><Badge tone="info">交互设计稿 · 模拟数据</Badge></header>
    <div className="shell">
      <aside className="projectNav" aria-label="项目导航"><p className="muted">数字人项目</p><strong>演示数字人</strong><p className="muted">demo</p>
        <nav>{['概览', '开发', '开发资源', '发布与上线', '运行与诊断', '项目设置'].map((label) => <Button key={label} variant={area === (label === '开发资源' ? 'resources' : label === '项目设置' ? 'settings' : '') ? 'secondary' : 'ghost'} aria-current={area === (label === '开发资源' ? 'resources' : label === '项目设置' ? 'settings' : '') ? 'page' : undefined} onClick={() => label === '开发资源' ? move('resources', 'api') : label === '项目设置' ? move('settings', 'config') : setNotice(`正式界面将进入「${label}」。本设计稿只演示项目设置与开发资源。`)}>{label}</Button>)}</nav>
        <div className="navHint">查资料 → 开发资源<br />改配置 → 项目设置</div>
      </aside>
      <main><div className="mobileArea"><Button onClick={() => move('settings', 'config')} aria-pressed={area === 'settings'}>项目设置</Button><Button onClick={() => move('resources', 'api')} aria-pressed={area === 'resources'}>开发资源</Button></div>
        <PageHeader title={area === 'settings' ? '项目设置' : '开发资源'} description={area === 'settings' ? '管理应用变量、展示方式和协作成员。' : '查找可用能力，以及在代码中接入它们的方法。'} actions={<Badge>{roles[role]}</Badge>} />
        {pending ? <ConfirmationPanel question="有未保存的修改" hint="继续编辑可保留当前输入；放弃后离开会清除当前页面中的草稿。" confirmLabel="放弃修改并继续" cancelLabel="继续编辑" onConfirm={() => { pending(); setPending(undefined); }} onCancel={() => setPending(undefined)} /> : null}
        {notice ? <p role="status" className="notice">{notice}</p> : null}
        <div className="sectionLayout">
          <nav className="sectionNav" aria-label={area === 'settings' ? '设置分组' : '资源主题'}>{items.map((value) => <Button key={value} variant={group === value ? 'secondary' : 'ghost'} aria-current={group === value ? 'page' : undefined} onClick={() => move(area, value)}><span>{groups[value][0]}</span><small>{groups[value][1]}</small></Button>)}</nav>
          <div className="mobileSection"><FormField label={area === 'settings' ? '设置分组' : '资源主题'}><select value={group} onChange={(event) => move(area, event.target.value as Group)}>{items.map((value) => <option value={value} key={value}>{groups[value][0]}</option>)}</select></FormField></div>
          <div className="sectionContent" key={`${group}:${role}`}>
            {group === 'config' ? <ConfigDemo role={role} fail={fail} onDirty={setDirty} onGuide={() => move('resources', 'guide')} /> : area === 'settings' ? <SettingsDemo section={group} role={role} fail={fail} onDirty={setDirty} /> : <ResourceDemo section={group} onSettings={() => move('settings', 'config')} onDestination={setNotice} />}
          </div>
        </div>
        {reviewMode ? <footer className="reviewTools"><span><strong>原型评审模式</strong><br />所有操作只改变本页示例</span><FormField label="预览身份"><select value={role} onChange={(event) => switchRole(event.target.value as DemoRole)}>{Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField><FormField label="模拟保存结果"><select value={fail ? 'failure' : 'success'} onChange={(event) => setFail(event.target.value === 'failure')}><option value="success">成功</option><option value="failure">服务暂时不可用</option></select></FormField></footer> : null}
      </main>
    </div>
  </>;
}
createRoot(document.getElementById('root')!).render(<App />);
