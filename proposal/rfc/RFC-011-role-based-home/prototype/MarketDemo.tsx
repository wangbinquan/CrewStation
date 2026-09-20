import { useState } from 'react';
import { ActionNote } from '../../../../apps/console/src/shared/ui/ActionNote';
import { ActionRow } from '../../../../apps/console/src/shared/ui/ActionRow';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { EmptyState } from '../../../../apps/console/src/shared/ui/EmptyState';
import { FormField } from '../../../../apps/console/src/shared/ui/FormField';
import { PageHeader } from '../../../../apps/console/src/shared/ui/PageHeader';
import { GlyphIcon } from '../../../../apps/console/src/shared/ui/icons/GlyphIcon';
import type { GlyphName } from '../../../../apps/console/src/shared/ui/icons/GlyphIcon';

interface DemoApp { id: string; name: string; description: string; owner: string; icon: GlyphName; state: 'ready' | 'beta' | 'maintenance' }
const applications: DemoApp[] = [
  { id: 'expenses', name: '报销助手', description: '整理票据、核对报销规则，让报销更省心。', owner: '李明', icon: 'workflow', state: 'ready' },
  { id: 'knowledge', name: '团队知识库', description: '查找制度、操作指南与团队经验，快速获得答案。', owner: '张宁', icon: 'book', state: 'ready' },
  { id: 'report', name: '数据看板', description: '查看业务进展和关键数据，让团队信息一目了然。', owner: '王悦', icon: 'chart', state: 'ready' },
  { id: 'customer', name: '客户回访助手', description: '整理客户反馈和后续事项，帮助团队及时跟进。', owner: '林晓', icon: 'assistant', state: 'beta' },
  { id: 'purchase', name: '采购申请', description: '提交采购需求，查看申请进展和处理结果。', owner: '周然', icon: 'station', state: 'ready' },
  { id: 'weekly', name: '周报助手', description: '汇总一周的工作进展，轻松准备团队周报。', owner: '陈可', icon: 'spark', state: 'maintenance' },
];

function AppStatus({ app }: { app: DemoApp }) {
  return app.state === 'beta' ? <Badge tone="info">Beta</Badge> : app.state === 'maintenance' ? <Badge tone="warning">维护中</Badge> : <span className="available"><span aria-hidden="true">●</span> 可使用</span>;
}

function ApplicationCard({ app, go }: { app: DemoApp; go(path: string): void }) {
  return <Card className="applicationCard" compact title={<span className="applicationName"><GlyphIcon name={app.icon} />{app.name}</span>} extra={<AppStatus app={app} />} footer={<ActionRow>
    <Button variant="primary" disabled={app.state === 'maintenance'} onClick={() => go(`/use/${app.id}`)}>{app.state === 'beta' ? '试用应用' : app.state === 'maintenance' ? '暂不可用' : '打开应用'}</Button>
    <Button variant="ghost" onClick={() => go(`/market/${app.id}`)}>了解应用</Button>
  </ActionRow>}>
    <p className="applicationDescription">{app.description}</p><p className="muted">负责人 · {app.owner}</p>
  </Card>;
}

function ApplicationDetail({ app, go }: { app: DemoApp; go(path: string): void }) {
  return <>
    <Button variant="ghost" onClick={() => go('/market')}>← 返回能力市场</Button>
    <PageHeader title={app.name} description={app.description} actions={<AppStatus app={app} />} />
    <Card stacked title="关于这个应用" className="detailCard">
      <p>{app.description}</p><p className="muted">负责人 · {app.owner}</p>
      {app.state === 'beta' ? <ActionNote tone="neutral">这是尚未正式发布的应用，你已获得试用资格。试用会使用真实业务数据，请留意提交的内容。</ActionNote> : null}
      {app.state === 'maintenance' ? <ActionNote tone="neutral">应用正在维护，请稍后再试。如需帮助，请联系应用负责人。</ActionNote> : <ActionRow><Button variant="primary" onClick={() => go(`/use/${app.id}`)}>{app.state === 'beta' ? '试用应用' : '打开应用'}</Button></ActionRow>}
    </Card>
  </>;
}

function ApplicationUse({ app, go }: { app: DemoApp; go(path: string): void }) {
  const [input, setInput] = useState(''), [sent, setSent] = useState(false);
  return <><Button variant="ghost" onClick={() => go('/market')}>← 返回能力市场</Button><PageHeader title={app.name} description="开始处理你的工作" actions={<AppStatus app={app} />} />
    <Card stacked title="有什么需要帮助？" className="detailCard">
      {app.state === 'beta' ? <ActionNote tone="neutral">Beta · 仅向获得试用资格的成员开放。试用会使用真实业务数据，请留意提交的内容。</ActionNote> : null}
      <FormField label="你的需求"><textarea rows={4} value={input} onChange={(event) => { setInput(event.target.value); setSent(false); }} placeholder="例如：帮我整理今天需要跟进的事项" /></FormField>
      <ActionRow><Button variant="primary" disabled={!input.trim()} onClick={() => setSent(true)}>开始处理</Button></ActionRow>
      {sent ? <ActionNote tone="success">已在设计稿中演示应用打开后的落点。未调用真实业务服务。</ActionNote> : null}
    </Card></>;
}

export function MarketDemo({ path, go, trialMember, failure }: { path: string; go(path: string): void; trialMember: boolean; failure: boolean }) {
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [retried, setRetried] = useState(false);
  const visible = applications.filter((app) => app.state !== 'beta' || trialMember), id = path.split('/')[2];
  const selected = visible.find((app) => app.id === id);
  if (id && !selected) return <EmptyState title="此应用不存在或暂未向你开放" action={<Button onClick={() => go('/market')}>返回能力市场</Button>} />;
  if (selected) return path.startsWith('/use/') ? <ApplicationUse app={selected} go={go} /> : <ApplicationDetail app={selected} go={go} />;
  const found = visible.filter((app) => `${app.name}${app.description}`.includes(query));
  return <>
    <div className="marketHeading"><span className="eyebrow">团队的应用，工作的帮手</span><PageHeader title="能力市场" description="找到适合你的应用，开始处理日常工作。" /></div>
    <form className="applicationSearch" onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); }}>
      <FormField label="搜索应用"><input type="search" maxLength={120} placeholder="输入应用名称或想完成的工作" value={search} onChange={(event) => setSearch(event.target.value)} /></FormField>
      <Button type="submit" variant="primary">搜索</Button>{query ? <Button onClick={() => { setSearch(''); setQuery(''); }}>清除</Button> : null}
    </form>
    {failure ? <Card stacked><ActionNote tone="error">暂时无法读取应用，请稍后重试。</ActionNote><ActionRow><Button onClick={() => setRetried(true)}>重试</Button></ActionRow>{retried ? <p role="status">仍无法连接，已保留搜索内容。</p> : null}<details><summary>错误详情</summary><p>HTTP 503 · 演示请求标识：market-demo-01</p></details></Card> : <>
      <div className="listHeading"><h2>{query ? '搜索结果' : '可使用的应用'}</h2><span className="muted">{found.length} 个应用</span></div>
      {found.length ? <div className="applicationGrid">{found.map((app) => <ApplicationCard app={app} key={app.id} go={go} />)}</div> : <EmptyState title="没有找到匹配的应用" description="换个关键词试试，或清除搜索查看全部应用。" action={<Button onClick={() => { setSearch(''); setQuery(''); }}>查看全部应用</Button>} />}
      {found.some((app) => app.state === 'beta') ? <p className="betaHint"><Badge tone="info">Beta</Badge> 标有 Beta 的应用尚未正式发布，仅对获得试用资格的成员开放。</p> : null}
    </>}
  </>;
}
