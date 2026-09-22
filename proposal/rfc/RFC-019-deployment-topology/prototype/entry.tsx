// 独立设计附件入口：外壳、三条演示路径、评审工具。不连接真实 API。
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Brand } from '../../../../apps/console/src/shared/ui/Brand';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { FormField } from '../../../../apps/console/src/shared/ui/FormField';
import { ProjectOperationsDemo, ProjectOverviewDemo } from './ProjectDemo';
import { ClusterDemo } from './ClusterDemo';
import '../../../../apps/console/src/app/theme/tokens.css';
import '../../../../apps/console/src/app/theme/base.css';
import './prototype.css';

const review = new URLSearchParams(window.location.search).get('review') === '1';
const currentPath = () => window.location.hash.slice(1) || '/projects/demo';
type Theme = 'system' | 'light' | 'dark';

const PROJECT_NAV = [['概览', '/projects/demo'], ['开发会话', '/projects/demo/dev-session'], ['发布与上线', '/projects/demo/release'], ['运行与诊断', '/projects/demo/operations'], ['项目设置', '/projects/demo/settings']] as const;
const ADMIN_NAV = [['平台总览', '/admin'], ['用户与角色', '/admin/users'], ['集群管理', '/admin/cluster'], ['算力档位', '/admin/compute-profiles'], ['接入项目', '/admin/integrations']] as const;

function PreviewApp() {
  const [path, setPath] = useState(currentPath);
  const [tick, setTick] = useState(0), [auto, setAuto] = useState(true), [partial, setPartial] = useState(false), [many, setMany] = useState(false), [theme, setTheme] = useState<Theme>('system');
  const [selected, setSelected] = useState<string>();
  useEffect(() => { const sync = () => { setPath(currentPath()); setSelected(undefined); }; window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync); }, []);
  useEffect(() => { if (!auto) return; const timer = window.setInterval(() => setTick((t) => (t + 1) % 5), 15_000); return () => window.clearInterval(timer); }, [auto]);
  useEffect(() => { if (theme === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  // 换页时清掉选中：上一页选中的节点在别的图里不存在，留着会把整张图压暗。
  const go = (next: string) => { window.location.hash = next; setPath(next); setSelected(undefined); };
  const admin = path.startsWith('/admin'), nav = admin ? ADMIN_NAV : PROJECT_NAV;
  const page = path === '/projects/demo' ? <ProjectOverviewDemo tick={tick} partial={partial} go={go} />
    : path === '/projects/demo/operations' ? <ProjectOperationsDemo tick={tick} partial={partial} selected={selected} onSelect={setSelected} />
      : path === '/admin/cluster' ? <ClusterDemo tick={tick} partial={partial} many={many} selected={selected} onSelect={setSelected} />
        : <p className="topo-muted">「{nav.find(([, href]) => href === path)?.[0] ?? path}」沿用现有页面，本设计稿只覆盖概览、运行与诊断、集群管理三处。</p>;
  return <>
    <header className="homeHeader">
      <Button variant="ghost" className="brandAction" onClick={() => go('/projects/demo')} aria-label="CrewStation 首页"><Brand name="CrewStation" /></Button>
      <nav className="spaceNavigation" aria-label="功能空间">
        <Button variant="ghost">应用</Button>
        <Button variant="ghost" aria-current={!admin ? 'page' : undefined} onClick={() => go('/projects/demo')}>项目开发</Button>
        <Button variant="ghost" aria-current={admin ? 'page' : undefined} onClick={() => go('/admin/cluster')}>平台管理</Button>
      </nav>
      <div className="account"><span className="avatar" aria-hidden="true">管</span><span>平台管理员<small>管理员 · 演示</small></span></div>
    </header>
    <div className="shellBody">
      <aside className="sideNav" aria-label={admin ? '平台管理' : '项目页面'}>
        {!admin ? <div className="sideProject"><strong>演示数字人</strong><small>demo · 数字人</small></div> : <div className="sideProject"><strong>平台管理</strong><small>管理空间</small></div>}
        <nav>{nav.map(([label, href]) => <a key={href} href={`#${href}`} aria-current={path === href ? 'page' : undefined} onClick={(event) => { event.preventDefault(); go(href); }}>{label}</a>)}</nav>
      </aside>
      <main className="pageMain">{page}</main>
    </div>
    <footer className="prototypeFooter"><span>RFC-019 交互设计稿 · 所有项目、Pod、时间与计数均为本页模拟，不连接真实集群</span>
      {review ? <div className="reviewTools" aria-label="原型评审工具">
        <FormField label="主题"><select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></FormField>
        <FormField label="模拟自动刷新（15 秒换快照）"><select value={auto ? 'on' : 'off'} onChange={(event) => setAuto(event.target.value === 'on')}><option value="on">开</option><option value="off">关</option></select></FormField>
        <FormField label="快照序号（手动）"><select value={String(tick)} onChange={(event) => setTick(Number(event.target.value))}>{[0, 1, 2, 3, 4].map((t) => <option key={t} value={t}>{t}</option>)}</select></FormField>
        <FormField label="模拟部分来源失败"><select value={partial ? 'yes' : 'no'} onChange={(event) => setPartial(event.target.value === 'yes')}><option value="no">否</option><option value="yes">是</option></select></FormField>
        <FormField label="模拟 120 个项目"><select value={many ? 'yes' : 'no'} onChange={(event) => setMany(event.target.value === 'yes')}><option value="no">否（11 个）</option><option value="yes">是</option></select></FormField>
        <a href="/archify/crewstation-platform.html" target="_blank" rel="noreferrer">Archify 生成的静态架构图（对照）↗</a>
      </div> : null}
    </footer>
  </>;
}

createRoot(document.getElementById('root')!).render(<PreviewApp />);
