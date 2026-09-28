import { useState } from 'react';
import type { ReactNode } from 'react';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Stack } from '../../../../apps/console/src/shared/ui/Stack';
import { ActionRow } from '../../../../apps/console/src/shared/ui/ActionRow';
import { Segmented } from '../../../../apps/console/src/shared/ui/Segmented';
import { DataTable } from '../../../../apps/console/src/shared/ui/DataTable';
import { Dialog } from '../../../../apps/console/src/shared/ui/dialog/Dialog';
import { DefinitionList } from '../../../../apps/console/src/shared/ui/DefinitionList';
import { EmptyState } from '../../../../apps/console/src/shared/ui/EmptyState';
import type { Attempt, Run } from './fixture';
import { duration, summarize, tokenLabel, agentGroups } from './aggregation';
import { MetricGrid, Notice, Status, UsageBreakdown } from './Metrics';
const attemptLabels = { initial: '首次执行', retry: '技术重试', turn: '续聊回合' };
export function AttemptDialog({ attempt, run, onClose }: { attempt: Attempt; run: Run; onClose: () => void }) {
  return <Dialog title={`${attempt.agent} · ${attemptLabels[attempt.kind]}`} onClose={onClose} size="large"><Stack>
    <Notice warning={attempt.state === 'failed'}>{attempt.state === 'failed' ? '执行失败：示例工具返回非零退出码；本次消耗仍计入任务总量。' : attempt.complete ? '本次执行已结束，用量完整。' : '采集尚未完整；未知字段不能按零统计。'}</Notice>
    <DefinitionList layout="grid" items={[{ label: '所属任务', value: run.id }, { label: '执行标识', value: attempt.id }, { label: '档位快照', value: attempt.profile }, { label: '相对起止', value: `${duration(attempt.start)} → ${duration(attempt.end)}` }, { label: '执行历时', value: duration(attempt.end - attempt.start) }, { label: 'Token', value: tokenLabel([attempt]) }]} />
    <UsageBreakdown attempts={[attempt]} />
    <Card compact title="相关事件（合成）"><ol className="eventList"><li>+{duration(attempt.start)} · Runner 已就绪，开始执行</li><li>+{duration(attempt.start + Math.floor((attempt.end-attempt.start)*.6))} · 工具调用 {attempt.state === 'failed' ? '检查失败' : '完成'}</li><li>+{duration(attempt.end)} · {attempt.state === 'running' ? '观测水位，执行仍在继续' : '收到最终执行状态'}</li></ol></Card>
    <p className="muted small">项目视角按公开档位归因；模型供应商、采购单价与凭据不进入此明细。</p>
  </Stack></Dialog>;
}
function TimelineRow({ label, hint, max, children, value }: { label: string; hint: string; max: number; children: ReactNode; value: string }) {
  return <div className="lane"><div className="laneName"><strong>{label}</strong><small>{hint}</small></div><div className="laneTrack" data-duration={max}>{children}</div><div className="laneValue">{value}</div></div>;
}
function AttemptBar({ a, max, onSelect, focus }: { a: Attempt; max: number; onSelect: (a: Attempt) => void; focus: boolean }) {
  const style = { left: `${a.start/max*100}%`, width: `${(a.end-a.start)/max*100}%`, opacity: focus && a.state !== 'failed' ? .38 : 1 };
  return <button className={`executionBar ${a.state}`} style={style} onClick={() => onSelect(a)} aria-label={`${a.agent} ${attemptLabels[a.kind]} ${duration(a.end-a.start)} ${tokenLabel([a])}`}><span>{a.state === 'failed' ? '× ' : ''}{attemptLabels[a.kind]}</span></button>;
}
function Swimlane({ run, onSelect }: { run: Run; onSelect: (a: Attempt) => void }) {
  const [zoom, setZoom] = useState('1'), [failedOnly, setFailedOnly] = useState(false), [expanded, setExpanded] = useState(true), [layer, setLayer] = useState('execution');
  const max = layer === 'execution' ? run.wall : run.container, groups = agentGroups([run]);
  return <Stack><ActionRow><Segmented label="时间轴层级" value={layer} items={[{value:'execution',label:'业务与 Agent'}, {value:'resource',label:'容器生命周期'}]} onChange={setLayer} /><Button size="small" onClick={() => setExpanded(!expanded)}>{expanded ? '合并同一 Agent' : '展开每次执行'}</Button><Button size="small" aria-pressed={failedOnly} onClick={() => setFailedOnly(!failedOnly)}>{failedOnly ? '显示全部执行' : '突出失败'}</Button><Segmented label="泳道缩放" value={zoom} items={[{value:'1',label:'适应'},{value:'2',label:'2x'}]} onChange={setZoom} /></ActionRow>
    <div className="timelineScroll" role="region" aria-label="Agent 执行泳道，可横向滚动" tabIndex={0}><div className="timeline" style={{minWidth: `${Number(zoom)*760}px`}}><div className="lane axisRow"><div className="laneName">{layer === 'execution' ? '任务 / Agent' : '平台执行环境'}</div><div className="timeAxis">{Array.from({length:5},(_,i)=><span key={i} style={{left:`${i*25}%`}}>{duration(Math.round(max*i/4))}</span>)}</div><div className="laneValue">Token</div></div>
      <TimelineRow label={layer === 'execution' ? '任务整体' : '父任务容器'} hint={layer === 'execution' ? '以业务结果完成为终点' : `结果后保留 ${duration(run.container - run.wall)}`} max={max} value={tokenLabel(run.attempts)}><div className="parentBar" style={{width:'100%'}} />{run.id === 'CS-0928-01' && layer === 'execution' && <span className="waitBar" style={{left:`${500/max*100}%`,width:`${40/max*100}%`}} title="人工确认等待 40 秒" />}{layer === 'resource' && <span className="retainedBar" style={{left:`${run.wall/max*100}%`,width:`${(run.container-run.wall)/max*100}%`}}>容器保留</span>}</TimelineRow>
      {expanded ? run.attempts.map((a)=><TimelineRow key={a.id} label={a.agent} hint={`${attemptLabels[a.kind]} · ${a.profile}`} max={max} value={tokenLabel([a])}><AttemptBar a={a} max={max} onSelect={onSelect} focus={failedOnly}/></TimelineRow>) : groups.map((g)=><TimelineRow key={g.key} label={g.name} hint={`${g.attempts.length} 次执行 · 累计 ${duration(summarize(g.attempts).seconds)}`} max={max} value={tokenLabel(g.attempts)}>{g.attempts.map((a)=><AttemptBar key={a.id} a={a} max={max} onSelect={onSelect} focus={failedOnly}/>)}</TimelineRow>)}
    </div></div>
    <div className="timelineLegend"><span><i className="legendActivity"/>Agent 执行</span><span><i className="legendFailure"/>失败</span><span><i className="legendWait"/>人工等待</span><span>轮廓条是汇总，不与子条相加</span></div><p className="muted small">协作由业务应用编排；缺少完整依赖边，本示例不推断关键路径。选择片段可查看事件和用量。</p>
  </Stack>;
}
export function ExecutionView({ run, onBack }: { run: Run; onBack: () => void }) {
  const [tab,setTab]=useState('timeline'),[selected,setSelected]=useState<Attempt|null>(null), s=summarize(run.attempts);
  return <Stack><ActionRow><Button onClick={onBack}>← 返回运行列表</Button><span className="muted">{run.id} / {run.release}</span></ActionRow><div className="sectionHeading"><div><h2>{run.name}</h2><p className="muted small">{run.source} · 全生命周期 · 包含所有尝试</p></div><Status state={run.state}/></div>
    <MetricGrid items={[{title:'任务总 Token',value:tokenLabel(run.attempts),hint:`${agentGroups([run]).length} 个 Agent · ${s.count} 次执行`},{title:run.kind==='business'?'业务完成历时':'平台执行历时',value:duration(run.wall),hint:run.state==='running'?'截至快照水位':'结果结束，容器保留另计'},{title:'Agent 累计执行',value:duration(s.seconds),hint:'并发区间可以重叠'},{title:'父容器存活',value:duration(run.container),hint:'容器时间不代表模型计算时间'}]}/>
    {!run.attempts.length ? <EmptyState title="本次是命令执行，没有 Agent 用量" description="Token 不适用；不会被记成模型采集缺失。"/> : <Card compact title="执行分析"><Stack><Segmented label="执行分析视图" value={tab} items={[{value:'timeline',label:'执行泳道'},{value:'agents',label:'Agent 汇总'},{value:'attempts',label:'逐次执行'}]} onChange={setTab}/>
      {tab==='timeline'&&<Swimlane run={run} onSelect={setSelected}/>}
      {tab==='agents'&&<DataTable columns={['Agent','执行次数','Token','累计执行','失败消耗']}>{agentGroups([run]).map((a)=><tr key={a.key}><td>{a.name}</td><td>{a.attempts.length}</td><td>{tokenLabel(a.attempts)}</td><td>{duration(summarize(a.attempts).seconds)}</td><td>{a.attempts.some((x)=>x.state==='failed')?tokenLabel(a.attempts.filter((x)=>x.state==='failed')):'0'}</td></tr>)}</DataTable>}
      {tab==='attempts'&&<DataTable columns={['Agent / 执行','状态','Token','历时','操作']}>{run.attempts.map((a)=><tr key={a.id}><td>{a.agent}<small>{a.id} · {attemptLabels[a.kind]}</small></td><td><Status state={a.state}/></td><td>{tokenLabel([a])}</td><td>{duration(a.end-a.start)}</td><td><Button size="small" onClick={()=>setSelected(a)}>查看片段</Button></td></tr>)}</DataTable>}
    </Stack></Card>}{selected&&<AttemptDialog attempt={selected} run={run} onClose={()=>setSelected(null)}/>}</Stack>;
}
