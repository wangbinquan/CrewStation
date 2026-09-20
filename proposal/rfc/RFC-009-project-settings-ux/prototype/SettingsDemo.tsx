import { useEffect, useRef, useState } from 'react';
import { ActionNote } from '../../../../apps/console/src/shared/ui/ActionNote';
import { ActionRow } from '../../../../apps/console/src/shared/ui/ActionRow';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { ConfirmationPanel } from '../../../../apps/console/src/shared/ui/ConfirmationPanel';
import { FormField } from '../../../../apps/console/src/shared/ui/FormField';
import { GlyphIcon } from '../../../../apps/console/src/shared/ui/icons/GlyphIcon';
import type { GlyphName } from '../../../../apps/console/src/shared/ui/icons/GlyphIcon';
import { Stack } from '../../../../apps/console/src/shared/ui/Stack';
import type { DemoRole } from './entry';

interface SettingsProps { section: string; role: DemoRole; fail: boolean; onDirty: (dirty: boolean) => void }
export function SettingsDemo(props: SettingsProps) {
  if (props.section === 'visibility') return <PresentationDemo {...props} />;
  if (props.section === 'members') return <MembersDemo {...props} />;
  return <AdvancedDemo role={props.role} fail={props.fail} />;
}
const scopes = { members: '项目成员', all: '全部登录用户', selected: '项目成员与指定用户' };
function PresentationDemo({ role, fail, onDirty }: SettingsProps) {
  const [saved, setSaved] = useState({ description: '帮助团队查询信息、处理日常任务。', icon: 'station' as GlyphName });
  const [draft, setDraft] = useState(saved), [editing, setEditing] = useState(false);
  const [scope, setScope] = useState('members'), [scopeDraft, setScopeDraft] = useState('members');
  const [people, setPeople] = useState(''), [savedPeople, setSavedPeople] = useState(''), [scopeEditing, setScopeEditing] = useState(false);
  const [notice, setNotice] = useState(''), [error, setError] = useState(''), [invalid, setInvalid] = useState(false);
  const [cancel, setCancel] = useState<'presentation' | 'scope'>();
  const changed = JSON.stringify(saved) !== JSON.stringify(draft), scopeChanged = scope !== scopeDraft || savedPeople !== people;
  useEffect(() => { onDirty(changed || scopeChanged); }, [changed, scopeChanged, onDirty]);
  const discard = (part: 'presentation' | 'scope') => { if (part === 'presentation') { setDraft(saved); setEditing(false); } else { setScopeDraft(scope); setPeople(savedPeople); setScopeEditing(false); } setCancel(undefined); };
  const save = (part: 'presentation' | 'scope') => {
    if (fail) { setError('保存失败（HTTP 503）。当前表单和另一项草稿均已保留。'); return; }
    if (part === 'presentation') { if (draft.description.length > 400) { setInvalid(true); return; } setSaved(draft); setEditing(false); } else { setScope(scopeDraft); setSavedPeople(people); setScopeEditing(false); }
    setError(''); setNotice(part === 'presentation' ? '展示资料已保存（演示）。未保存的可见范围不受影响。' : '市场可见范围已保存（演示）。未保存的展示资料不受影响。');
  };
  return <Stack><div className="sectionHeading"><h2>应用展示</h2><p className="muted">决定应用在能力市场里如何展示。</p></div>
    {role === 'developer' ? <ActionNote tone="neutral">由项目负责人维护。你可以查看当前展示资料和市场可见范围。</ActionNote> : null}
    <Card compact stacked title="展示资料" extra={!editing && role !== 'developer' ? <Button onClick={() => setEditing(true)}>编辑展示资料</Button> : undefined}>
      {editing ? <form className="editorForm" noValidate onSubmit={(event) => { event.preventDefault(); save('presentation'); }}><FormField label="应用用途" hint="最多 400 字，可留空。说明应用可以帮助使用者完成什么。" error={invalid && draft.description.length > 400 ? '应用用途不能超过 400 字。' : undefined}><textarea rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></FormField><FormField label="应用图标"><select value={draft.icon} onChange={(event) => setDraft({ ...draft, icon: event.target.value as GlyphName })}>{Object.entries({ station: '协作舱', assistant: '助手', workflow: '工作流', book: '知识', chart: '分析', spark: '创意' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField><ActionRow><Button variant="primary" type="submit">保存展示资料</Button><Button onClick={() => changed ? setCancel('presentation') : discard('presentation')}>取消展示编辑</Button></ActionRow></form> : <div className="presentationPreview"><GlyphIcon name={saved.icon} /><div><strong>演示数字人</strong><p className="muted">{saved.description || '尚未填写用途'}</p></div></div>}
    </Card>
    <Card compact stacked title="市场可见范围" extra={!scopeEditing && role !== 'developer' ? <Button onClick={() => setScopeEditing(true)}>修改可见范围</Button> : undefined}>
      {scopeEditing ? <form className="editorForm" onSubmit={(event) => { event.preventDefault(); save('scope'); }}><FormField label="谁能在市场看到应用"><select value={scopeDraft} onChange={(event) => setScopeDraft(event.target.value)}>{Object.entries(scopes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>{scopeDraft === 'selected' ? <FormField label="指定用户（模拟）" hint="正式界面精确查找已注册账号；保留现有的多人选择方式。"><input value={people} onChange={(event) => setPeople(event.target.value)} placeholder="例如 viewer@example.test" /></FormField> : null}<ActionRow><Button variant="primary" type="submit">保存可见范围</Button><Button onClick={() => scopeChanged ? setCancel('scope') : discard('scope')}>取消范围编辑</Button></ActionRow></form> : <p>{scopes[scope as keyof typeof scopes]}{scope === 'selected' && savedPeople ? ` · ${savedPeople}` : ''}</p>}
      <p className="muted">只影响市场目录与详情的展示；不授予开发、数据或 API 权限，也不改变正式链接的访问规则。</p>
    </Card>
    {cancel ? <ConfirmationPanel question={`放弃${cancel === 'presentation' ? '展示资料' : '可见范围'}的修改？`} hint="另一项草稿会保留。" confirmLabel="放弃当前修改" cancelLabel="继续编辑" onConfirm={() => discard(cancel)} onCancel={() => setCancel(undefined)} /> : null}
    {notice ? <ActionNote tone="success">{notice}</ActionNote> : null}{error ? <ActionNote tone="error">{error}</ActionNote> : null}
    {role !== 'developer' ? <details><summary>检查谁能看到应用</summary><div className="detailContent"><p className="muted">正式界面按服务器上已保存的范围，精确查找账号并检查；草稿不参与判定。</p></div></details> : null}
  </Stack>;
}
function MembersDemo({ role, fail, onDirty }: SettingsProps) {
  const [open, setOpen] = useState(false), [identity, setIdentity] = useState(''), [memberRole, setMemberRole] = useState('开发者');
  const [found, setFound] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [cancel, setCancel] = useState(false);
  const [members, setMembers] = useState([{ name: '项目负责人', role: '负责人' }, { name: '示例开发者', role: '开发者' }]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { onDirty(open && identity !== ''); }, [open, identity, onDirty]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  return <Stack><div className="sectionHeading"><h2>成员与角色</h2><p className="muted">管理参与开发和版本试用的人。</p></div>
    {role === 'developer' ? <ActionNote tone="neutral">由项目负责人维护。成员身份与应用在市场里的可见范围分别管理。</ActionNote> : null}
    <Card compact stacked title="项目成员" extra={role !== 'developer' ? <Button variant="primary" onClick={() => setOpen(true)}>添加成员</Button> : undefined}>
      {members.map((item) => <div key={item.name} className="memberRow"><span>{item.name}</span><Badge>{item.role}</Badge>{role !== 'developer' && item.role !== '负责人' ? <Button onClick={() => { setOpen(true); setIdentity('dev@example.test'); setFound(true); }}>修改角色</Button> : <span className="muted">{item.role === '负责人' ? '当前负责人' : '项目成员'}</span>}</div>)}
    </Card>
    {open ? <Card compact stacked title="添加成员或修改角色"><form className="editorForm" onSubmit={(event) => { event.preventDefault(); if (!found) { setError('请先查找并确认目标账号。'); input.current?.focus(); return; } if (fail) { setError('保存失败（HTTP 503）。账号和角色已保留。'); return; } setMembers((all) => [...all.filter((item) => item.name !== '示例开发者'), { name: '示例开发者', role: memberRole }]); setOpen(false); setIdentity(''); setFound(false); setError(''); setNotice('示例开发者的角色已保存（演示）。'); }}>
      <FormField label="完整邮箱或用户 ID" hint="精确匹配已注册账号，最多 254 字；设计稿使用 dev@example.test。" error={error || undefined}><input ref={input} value={identity} onChange={(event) => { setIdentity(event.target.value); setFound(false); }} /></FormField>
      <ActionRow><Button onClick={() => { if (identity.trim() === 'dev@example.test') { setFound(true); setError(''); } else { setFound(false); setError('设计稿仅有 dev@example.test 这个示例账号。'); } }}>查找账号</Button>{found ? <Badge tone="success">已选择：示例开发者</Badge> : null}</ActionRow>
      <FormField label="角色" hint={memberRole === '开发者' ? '可以开发、发布待验证版本和维护开发变量。' : '只可访问试用版本。'}><select value={memberRole} onChange={(event) => setMemberRole(event.target.value)}><option>开发者</option><option>测试者</option></select></FormField>
      <details><summary>其他选择方式</summary><p className="detailContent muted">正式界面保留高级用户 ID 输入{role === 'admin' ? '、管理员用户目录及负责人转移' : ''}，沿用当前校验和确认。</p></details>
      <ActionRow><Button variant="primary" type="submit">保存成员</Button><Button onClick={() => { if (identity) setCancel(true); else { setOpen(false); setError(''); } }}>取消</Button></ActionRow>
    </form></Card> : null}{cancel ? <ConfirmationPanel question="放弃未保存的成员设置？" hint="当前选择的账号和角色尚未保存。" confirmLabel="放弃成员设置" cancelLabel="继续编辑" onConfirm={() => { setOpen(false); setIdentity(''); setFound(false); setError(''); setCancel(false); }} onCancel={() => setCancel(false)} /> : null}{notice ? <ActionNote tone="success">{notice}</ActionNote> : null}
    <p className="muted">负责人由平台管理员转移。应用面向谁展示，在「应用展示」中设置。</p>
  </Stack>;
}
function AdvancedDemo({ role, fail }: { role: DemoRole; fail: boolean }) {
  const [confirm, setConfirm] = useState(false), [archived, setArchived] = useState(false), [error, setError] = useState('');
  return <Stack><div className="sectionHeading"><h2>高级</h2><p className="muted">查看项目状态，处理不常使用的管理操作。</p></div><Card compact stacked title="归档项目" extra={<Badge tone={archived ? 'neutral' : 'success'}>{archived ? '已归档（演示）' : '已开通'}</Badge>}><p>归档会将项目标记为已归档，并异步移除服务路由；源码仓库、数据库与文件保留。</p><p className="muted">已有开发会话和运行容器不会自动释放，需单独处理。当前没有恢复归档的入口。</p>{role === 'admin' ? <ActionRow><Button disabled={archived} onClick={() => setConfirm(true)}>归档项目…</Button></ActionRow> : <p>由平台管理员执行归档。</p>}{confirm ? <ConfirmationPanel question="归档「演示数字人」（demo）？" hint="服务路由将异步移除；此设计稿仅模拟，不改变真实项目。" confirmLabel="确认归档（演示）" cancelLabel="取消" onConfirm={() => { if (fail) { setError('归档失败（HTTP 503），项目仍未归档。'); return; } setArchived(true); setConfirm(false); setError(''); }} onCancel={() => setConfirm(false)} /> : null}{error ? <ActionNote tone="error">{error}</ActionNote> : null}</Card></Stack>;
}
