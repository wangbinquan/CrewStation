import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Brand } from '../../../../apps/console/src/shared/ui/Brand';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { FormField } from '../../../../apps/console/src/shared/ui/FormField';
import { ConfirmationPanel } from '../../../../apps/console/src/shared/ui/ConfirmationPanel';
import { EmptyState } from '../../../../apps/console/src/shared/ui/EmptyState';
import { PageHeader } from '../../../../apps/console/src/shared/ui/PageHeader';
import { MarketDemo } from './MarketDemo';
import { DevelopmentDemo } from './DevelopmentDemo';
import { AdministrationDemo } from './AdministrationDemo';
import '../../../../apps/console/src/app/theme/tokens.css';
import '../../../../apps/console/src/app/theme/base.css';
import './preview.css';

export type DemoRole = 'user' | 'developer' | 'admin';
export const roleNames = { user: '用户', developer: '开发者', admin: '管理员' };
export const actorNames = { user: '陈晨', developer: '林晓', admin: '平台管理员' };
const review = new URLSearchParams(window.location.search).get('review') === '1';
const currentPath = () => window.location.hash.slice(1) || '/market';
const spaceOf = (path: string) => path.startsWith('/projects') ? 'development' : path.startsWith('/admin') ? 'admin' : 'market';

function PreviewApp() {
  const [role, setRole] = useState<DemoRole>('user'), [path, setPath] = useState(currentPath);
  const [trialMember, setTrialMember] = useState(true), [failure, setFailure] = useState(false);
  const [dirty, setDirty] = useState(false), [pending, setPending] = useState<(() => void)>();
  useEffect(() => { const sync = () => setPath(currentPath()); window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync); }, []);
  const go = (next: string, saved = false) => {
    const move = () => { window.location.hash = next; setPath(next); setDirty(false); };
    if (dirty && !saved) setPending(() => move); else move();
  };
  const changeRole = (next: DemoRole) => {
    const apply = () => { setRole(next); setDirty(false); window.location.hash = '/market'; setPath('/market'); };
    if (dirty) setPending(() => apply); else apply();
  };
  const space = spaceOf(path), denied = space === 'development' && role === 'user' || space === 'admin' && role !== 'admin';
  return <>
    <header className="homeHeader">
      <Button variant="ghost" className="brandAction" onClick={() => go('/market')} aria-label="CrewStation 首页"><Brand name="CrewStation" /></Button>
      <nav className="spaceNavigation" aria-label="功能空间">
        <Button variant="ghost" aria-current={space === 'market' ? 'page' : undefined} onClick={() => go('/market')}>应用</Button>
        {role !== 'user' ? <Button variant="ghost" aria-current={space === 'development' ? 'page' : undefined} onClick={() => go('/projects')}>项目开发</Button> : null}
        {role === 'admin' ? <Button variant="ghost" aria-current={space === 'admin' ? 'page' : undefined} onClick={() => go('/admin')}>平台管理</Button> : null}
      </nav>
      <div className="account"><span className="avatar" aria-hidden="true">{actorNames[role].slice(0, 1)}</span><span>{actorNames[role]}<small>{roleNames[role]}</small></span></div>
    </header>
    <main className={`homeMain ${space !== 'market' ? 'workingMain' : ''}`}>
      {pending ? <ConfirmationPanel question="离开并放弃未保存的项目？" hint="你可以继续编辑，保留已经填写的内容。" confirmLabel="放弃并离开" cancelLabel="继续编辑" onConfirm={() => { pending(); setPending(undefined); }} onCancel={() => setPending(undefined)} /> : null}
      {denied ? <><PageHeader title="此页面需要相应角色" /><EmptyState title={space === 'admin' ? '平台管理仅对管理员开放' : '项目开发仅对开发者和管理员开放'} description="你仍可以从能力市场使用获准访问的应用。" action={<Button variant="primary" onClick={() => go('/market')}>返回能力市场</Button>} /></> :
        space === 'market' ? <MarketDemo path={path} go={go} trialMember={trialMember || role !== 'user'} failure={failure} /> :
          space === 'development' ? <DevelopmentDemo key={role} role={role} path={path} go={go} onDirty={setDirty} failure={failure} /> : <AdministrationDemo path={path} go={go} />}
    </main>
    <footer className="prototypeFooter"><span>RFC-011 交互设计稿 · 所有账号、应用和操作均为本页模拟</span>
      {review ? <div className="reviewTools" aria-label="原型评审工具">
        <FormField label="预览身份"><select value={role} onChange={(event) => changeRole(event.target.value as DemoRole)}>{Object.entries(roleNames).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></FormField>
        <FormField label="应用试用资格"><select value={trialMember ? 'member' : 'none'} onChange={(event) => setTrialMember(event.target.value === 'member')}><option value="member">已加入客户回访助手</option><option value="none">没有试用资格</option></select></FormField>
        <FormField label="模拟服务响应"><select value={failure ? 'failure' : 'success'} onChange={(event) => setFailure(event.target.value === 'failure')}><option value="success">正常</option><option value="failure">暂时不可用</option></select></FormField>
      </div> : null}
    </footer>
  </>;
}

createRoot(document.getElementById('root')!).render(<PreviewApp />);
