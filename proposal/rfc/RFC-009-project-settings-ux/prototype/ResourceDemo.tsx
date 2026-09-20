import { useState } from 'react';
import { ActionNote } from '../../../../apps/console/src/shared/ui/ActionNote';
import { ActionRow } from '../../../../apps/console/src/shared/ui/ActionRow';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { DefinitionList } from '../../../../apps/console/src/shared/ui/DefinitionList';
import { FormField } from '../../../../apps/console/src/shared/ui/FormField';
import { Stack } from '../../../../apps/console/src/shared/ui/Stack';

interface ResourceProps { section: string; onSettings: () => void; onDestination: (message: string) => void }
export function ResourceDemo(props: ResourceProps) {
  if (props.section === 'api') return <ApiDemo />;
  if (props.section === 'events') return <EventDemo onDestination={props.onDestination} />;
  if (props.section === 'data') return <DataDemo onDestination={props.onDestination} />;
  if (props.section === 'guide') return <GuideDemo onSettings={props.onSettings} />;
  return <ProjectDemo onDestination={props.onDestination} />;
}
function ApiDemo() {
  const [selected, setSelected] = useState(false), [result, setResult] = useState(false), [request, setRequest] = useState(false), [sent, setSent] = useState(false);
  return <Stack><div className="sectionHeading"><h2>API 接口</h2><p className="muted">查看接口说明、申请调用权限，并从当前开发会话试调。</p></div><Card compact stacked title="示例接口" extra={<Badge>2 个操作 · 模拟数据</Badge>}>
    <div className="resourceRow"><div><strong>查询示例信息</strong><p className="muted"><code>GET /api/hello</code> · 已授权</p></div><Button onClick={() => setSelected(!selected)}>{selected ? '收起文档' : '查看文档'}</Button></div>
    {selected ? <div className="detailContent"><Stack><p>返回示例问候。正式页面保留参数、响应说明、完整操作键和 Swagger 文档。</p><ActionRow><Button onClick={() => setResult(true)}>模拟试调</Button><Badge tone="info">从当前开发会话发出</Badge></ActionRow>{result ? <ActionNote tone="success">模拟响应：HTTP 200 · 128ms · task_demo · trace_demo。此数据不来自真实 API。</ActionNote> : null}</Stack></div> : null}
    <div className="resourceRow"><div><strong>创建示例工单</strong><p className="muted"><code>POST /tickets</code> · {sent ? '申请中' : '需申请调用'}</p></div><Button disabled={sent} onClick={() => setRequest(!request)}>{sent ? '等待处理' : '申请调用'}</Button></div>
    {request ? <form className="editorForm" onSubmit={(event) => { event.preventDefault(); setSent(true); setRequest(false); }}><FormField label="申请理由" hint="可选，最多 500 字；设计稿不会提交真实申请。"><textarea maxLength={500} rows={2} /></FormField><ActionRow><Button type="submit" variant="primary">提交申请（演示）</Button><Button onClick={() => setRequest(false)}>取消</Button></ActionRow></form> : null}
  </Card><p className="muted">无需先开启会话即可查文档；真实试调需要当前开发会话已连接。</p></Stack>;
}
function EventDemo({ onDestination }: Pick<ResourceProps, 'onDestination'>) {
  return <Stack><div className="sectionHeading"><h2>事件</h2><p className="muted">了解可订阅的事件，以及当前版本如何接收。</p></div><Card compact stacked title="当前订阅" extra={<Badge>在代码中声明</Badge>}><div className="resourceRow"><div><strong>GitLab 代码推送</strong><p className="muted"><code>gitlab.push</code> → <code>/events/gitlab</code></p></div><Badge tone="success">已登记</Badge></div><p>在 <code>crewstation.yaml</code> 的 subscriptions 中声明，发布时登记。事件发送到当前正式版本。</p><ActionRow><Button onClick={() => onDestination('目标：开发 → 代码 → crewstation.yaml。没有开发会话时先引导开启；本设计稿不编辑真实文件。')}>打开订阅声明 →</Button><Button variant="ghost" onClick={() => onDestination('目标：运行与诊断 → 事件投递，并保留当前订阅 ID。')}>查看投递记录 →</Button></ActionRow></Card><details><summary>可用事件类型</summary><div className="detailContent"><code>gitlab.push</code><p className="muted">GitLab 代码推送事件；正式界面显示平台目录中的真实类型和载荷说明。</p></div></details></Stack>;
}
function DataDemo({ onDestination }: Pick<ResourceProps, 'onDestination'>) {
  return <Stack><div className="sectionHeading"><h2>数据与存储</h2><p className="muted">查看已提供的资源和连接变量名。</p></div><Card compact stacked title="数据库" extra={<Badge>由平台提供</Badge>}><DefinitionList items={[{ label: '开发数据', value: <>PostgreSQL · 独立于生产 · <Badge tone="success">就绪</Badge></> }, { label: '生产数据', value: <>正式与待验证版本共用 · <Badge tone="success">就绪</Badge></> }, { label: '连接变量名', value: <code>CS_DATABASE_URL</code> }]} /><p className="muted">连接值注入运行环境，此处只展示变量名。开发库跨开发会话保留。</p><ActionRow><Button onClick={() => onDestination('目标：开发 → 数据访问（view=data）。保留正确项目，按原流程查看或申请数据访问。')}>查看或申请数据访问 →</Button></ActionRow></Card><details><summary>资源规格与技术信息</summary><div className="detailContent">示例规格：db-small；正式页面展示资源 ID、类型、环境、状态与读取失败原因。</div></details></Stack>;
}
function ProjectDemo({ onDestination }: Pick<ResourceProps, 'onDestination'>) {
  return <Stack><div className="sectionHeading"><h2>项目与仓库</h2><p className="muted">查看代码位置、应用地址和平台分配的资源。</p></div><Card compact stacked title="源码仓库" extra={<Badge>由平台提供</Badge>}><DefinitionList items={[{ label: '仓库', value: <code>crewstation/demo</code> }, { label: '默认分支', value: <code>main</code> }, { label: '状态', value: <Badge tone="success">已就绪</Badge> }]} /><ActionRow><Button onClick={() => onDestination('正式界面打开仓库接口返回的真实 httpUrl；本设计稿未连接仓库。')}>打开仓库 ↗</Button></ActionRow></Card><Card compact stacked title="资源额度"><DefinitionList items={[{ label: '并发任务', value: '1 / 3 · 运行中 / 上限（示例）' }, { label: '服务套餐', value: 'standard-small' }]} /><p className="muted">套餐由平台提供；需要调整资源时联系平台管理员。</p></Card><details><summary>应用地址与技术详情</summary><div className="detailContent"><DefinitionList items={[{ label: '正式应用', value: <code>demo.cs.localhost</code> }, { label: '待验证版本', value: <code>preview.demo.cs.localhost</code> }, { label: '开发预览', value: <code>dev.demo.cs.localhost</code> }, { label: '服务身份', value: <code>demo/demo</code> }, { label: '命名空间', value: <code>cs-demo</code> }]} /></div></details></Stack>;
}
function GuideDemo({ onSettings }: Pick<ResourceProps, 'onSettings'>) {
  const [copied, setCopied] = useState('');
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); setCopied(`已复制 ${value}`); } catch { setCopied(`复制未完成，请手动复制：${value}`); } };
  return <Stack><div className="sectionHeading"><h2>平台接入</h2><p className="muted">平台提供什么、代码读取什么，按主题查阅。</p></div><Card compact stacked title="平台自动提供的环境变量" extra={<Badge>由平台提供</Badge>}><div className="resourceRow"><div><code>CS_DATABASE_URL</code><p className="muted">当前运行环境的数据连接</p></div><Button onClick={() => { void copy('CS_DATABASE_URL'); }}>复制变量名</Button></div><div className="resourceRow"><div><code>CS_INTERNAL_API_BASE</code><p className="muted">服务调用的内部 API 基址</p></div><Button onClick={() => { void copy('CS_INTERNAL_API_BASE'); }}>复制变量名</Button></div><ActionRow><span className="muted">应用自己的变量和密钥</span><Button variant="ghost" onClick={onSettings}>前往环境变量设置 →</Button></ActionRow></Card>{copied ? <ActionNote tone="neutral">{copied}</ActionNote> : null}<details><summary>用户身份与请求头</summary><div className="detailContent"><p>正式界面按项目展示实际转发的身份字段、配置来源和请求头约定。</p><code>x-cs-user-id</code><p className="muted">平台完成登录；业务应用根据自己的规则使用身份信息。</p></div></details><details><summary>MCP 与业务子任务接口</summary><div className="detailContent"><p>能力说明 MCP、运维 MCP、业务任务与子任务接口均保留在这里，按主题查阅和复制。</p><p className="muted">任务契约在 crewstation.yaml 声明，随发布登记。</p></div></details><details><summary>完整变量、路径与事件头约定</summary><div className="detailContent">正式界面使用既有能力说明响应，保留完整约定和两组配置键名。这里仅示意展开位置。</div></details></Stack>;
}
