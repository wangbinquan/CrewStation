import { useRef, useState } from 'react';
import { ActionNote } from '../../../../apps/console/src/shared/ui/ActionNote';
import { ActionRow } from '../../../../apps/console/src/shared/ui/ActionRow';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { EmptyState } from '../../../../apps/console/src/shared/ui/EmptyState';
import { FormField } from '../../../../apps/console/src/shared/ui/FormField';
import { PageHeader } from '../../../../apps/console/src/shared/ui/PageHeader';
import type { DemoRole } from './entry';

interface DemoProject { id: string; name: string; owner: boolean; status: string }
interface DevelopmentProps { role: DemoRole; path: string; go(path: string, saved?: boolean): void; onDirty(value: boolean): void; failure: boolean }

function CreateProjectDemo({ onCreated, onDirty, failure, back }: { onCreated(name: string, slug: string): void; onDirty(value: boolean): void; failure: boolean; back(): void }) {
  const [name, setName] = useState(''), [slug, setSlug] = useState(''), [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({}), [failed, setFailed] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null), slugRef = useRef<HTMLInputElement>(null);
  const next = () => {
    const issues: Record<string, string> = {};
    if (!name.trim() || name.trim().length > 80) issues.name = '请填写 1–80 字的项目名称。';
    if (!/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(slug.trim())) issues.slug = '请使用 3–40 位小写字母、数字或连字符；以字母开头，以字母或数字结尾。';
    setErrors(issues);
    if (Object.keys(issues).length) { if (issues.name) nameRef.current?.focus(); else slugRef.current?.focus(); return; }
    setStep(1);
  };
  return <><Button variant="ghost" onClick={back}>← 返回项目开发</Button><PageHeader title="新建项目" description="创建一个应用项目，邀请团队一起开发。" />
    <Card stacked className="creationCard" title={step === 0 ? '填写项目信息' : '确认并创建'}>
      <form noValidate onSubmit={(event) => { event.preventDefault(); if (step === 0) next(); else if (failure) setFailed(true); else { onDirty(false); onCreated(name.trim(), slug.trim()); } }}>
        {step === 0 ? <div className="formStack">
          <FormField label="项目名称" hint="必填，1–80 字；便于团队识别。" error={errors.name}><input ref={nameRef} value={name} aria-invalid={!!errors.name} onChange={(event) => { setName(event.target.value); onDirty(true); }} placeholder="例如：客户回访助手" /></FormField>
          <FormField label="访问标识" hint="必填，3–40 位小写字母、数字或连字符；以字母开头，以字母或数字结尾。创建后不可修改。" error={errors.slug}><input ref={slugRef} value={slug} aria-invalid={!!errors.slug} onChange={(event) => { setSlug(event.target.value); onDirty(true); }} placeholder="例如：customer-followup" /></FormField>
          <FormField label="起始模板"><select defaultValue="minimal-sample"><option value="minimal-sample">基础应用模板</option></select></FormField>
          <div className="creationSummary"><strong>你将成为项目负责人</strong><p>创建后可以管理成员、发布应用和正式上线。使用平台默认资源配置。</p></div>
        </div> : <div className="formStack"><dl className="reviewList"><dt>项目名称</dt><dd>{name}</dd><dt>访问标识</dt><dd>{slug}</dd><dt>负责人</dt><dd>我</dd><dt>模板</dt><dd>基础应用模板</dd><dt>资源</dt><dd>平台默认配置</dd></dl><p className="muted">创建后先准备项目环境，就绪后即可开始开发。</p></div>}
        {failed ? <ActionNote tone="error">暂时无法创建项目（HTTP 503）。已保留你的填写内容，请稍后重试。</ActionNote> : null}
        <ActionRow className="formActions">{step ? <Button onClick={() => setStep(0)}>返回修改</Button> : null}<Button type="submit" variant="primary">{step ? '确认创建' : '下一步'}</Button></ActionRow>
      </form>
    </Card></>;
}

function ProjectWorkspaceDemo({ project, go }: { project: DemoProject; go(path: string): void }) {
  return <><Button variant="ghost" onClick={() => go('/projects')}>← 返回项目开发</Button><PageHeader title={project.name} description="继续改进应用，让团队用得更顺手。" actions={<Badge tone="info">{project.owner ? '项目负责人' : '开发成员'}</Badge>} />
    <Card stacked title="开发会话"><ActionNote tone="neutral">这里接续现有的开发会话、项目设置和发布流程。</ActionNote><div className="developmentStatus"><Badge tone="success">本轮完成</Badge><span>CLI 1 · 完成提示保留在开发会话内</span></div><p className="muted">正式实现沿用 RFC-008 与 RFC-009，本设计稿只展示全局入口的分工。</p></Card></>;
}

export function DevelopmentDemo({ role, path, go, onDirty, failure }: DevelopmentProps) {
  const [projects, setProjects] = useState<DemoProject[]>([
    { id: 'customer', name: '客户回访助手', owner: true, status: '正在开发' },
    { id: 'purchase', name: '采购申请', owner: false, status: '已上线' },
  ]), [filter, setFilter] = useState(''), [createdId, setCreatedId] = useState('');
  const created = projects.find((project) => project.id === createdId);
  const create = (name: string, slug: string) => { setProjects((items) => [{ id: slug, name, owner: true, status: '准备中' }, ...items]); setCreatedId(slug); go(`/projects/${slug}/provisioning`, true); };
  if (path === '/projects/new') return <CreateProjectDemo onCreated={create} onDirty={onDirty} failure={failure} back={() => go('/projects')} />;
  if (path.endsWith('/provisioning') && created) return <><PageHeader title={created.name} description="项目已创建，你是项目负责人。" /><Card stacked title={created.status === '准备中' ? '正在准备项目' : '项目已就绪'}><p>{created.status === '准备中' ? '正在准备代码仓库和开发环境，请稍候。' : '现在可以开始开发，也可以邀请其他开发者加入。'}</p><ActionRow><Button variant="primary" onClick={() => created.status === '准备中' ? setProjects((items) => items.map((item) => item.id === createdId ? { ...item, status: '正在开发' } : item)) : go(`/projects/${created.id}`)}>{created.status === '准备中' ? '刷新进度' : '开始开发'}</Button><Button onClick={() => go('/projects')}>返回项目列表</Button></ActionRow></Card></>;
  const selected = projects.find((project) => path === `/projects/${project.id}`);
  if (selected) return <ProjectWorkspaceDemo project={selected} go={go} />;
  const visible = projects.filter((project) => project.name.includes(filter));
  return <><PageHeader title="项目开发" description={role === 'admin' ? '查看和开发平台中的全部数字人项目。' : '从已有项目继续开发，或创建一个新应用。'} actions={<Button variant="primary" onClick={() => go('/projects/new')}>＋ 新建项目</Button>} />
    <div className="projectToolbar"><h2>{role === 'admin' ? '全部项目' : '我参与开发的项目'}</h2><FormField label="查找项目"><input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="按项目名称搜索" /></FormField></div>
    <div className="projectList">{visible.map((project) => <Card key={project.id} compact className="projectRow"><div className="projectRowContent"><div><h3>{project.name}</h3><span className="muted">{project.owner ? '我负责的项目' : '我参与开发的项目'}</span></div><Badge tone={project.status === '已上线' ? 'success' : 'neutral'}>{project.status}</Badge><Button onClick={() => go(`/projects/${project.id}`)}>{project.status === '正在开发' ? '继续开发' : '进入项目'}</Button></div></Card>)}</div>
    {!visible.length ? <EmptyState title="没有找到匹配的项目" description="可以更换关键词，或创建一个新项目。" action={<Button onClick={() => go('/projects/new')}>新建项目</Button>} /> : null}
  </>;
}
