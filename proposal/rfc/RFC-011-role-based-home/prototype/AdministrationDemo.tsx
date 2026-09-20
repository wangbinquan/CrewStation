import { useState } from 'react';
import { ActionNote } from '../../../../apps/console/src/shared/ui/ActionNote';
import { ActionRow } from '../../../../apps/console/src/shared/ui/ActionRow';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { FormField } from '../../../../apps/console/src/shared/ui/FormField';
import { ConfirmationPanel } from '../../../../apps/console/src/shared/ui/ConfirmationPanel';
import { PageHeader } from '../../../../apps/console/src/shared/ui/PageHeader';
import type { DemoRole } from './entry';

const names = { user: '用户', developer: '开发者', admin: '管理员' };
const descriptions = { user: '使用已向其开放的应用；有试用资格时可使用 Beta 应用。', developer: '可以创建项目，并开发已获授权的项目。', admin: '同时具备开发者能力，并可管理平台与用户角色。' };

function RoleDirectoryDemo() {
  const [users, setUsers] = useState<{ name: string; email: string; role: DemoRole }[]>([
    { name: '陈晨', email: 'chen@example.test', role: 'user' }, { name: '林晓', email: 'lin@example.test', role: 'developer' }, { name: '平台管理员', email: 'admin@example.test', role: 'admin' },
  ]), [editing, setEditing] = useState<string>(), [target, setTarget] = useState<DemoRole>('user'), [confirm, setConfirm] = useState(false), [message, setMessage] = useState('');
  const selected = users.find((user) => user.email === editing), ownerBlock = selected?.email === 'lin@example.test' && target === 'user';
  const lastAdmin = selected?.role === 'admin' && target !== 'admin' && users.filter((user) => user.role === 'admin').length === 1;
  return <>
    {message ? <ActionNote tone="success">{message}</ActionNote> : null}
    <div className="roleList">{users.map((user) => <Card compact key={user.email} title={user.name} extra={<Badge tone={user.role === 'admin' ? 'info' : 'neutral'}>{names[user.role]}</Badge>} footer={<Button onClick={() => { setEditing(user.email); setTarget(user.role); setConfirm(false); setMessage(''); }}>修改角色</Button>}><p className="muted">{user.email}</p><p>{descriptions[user.role]}</p></Card>)}</div>
    {selected ? <Card stacked title={`修改 ${selected.name} 的平台角色`} className="roleEditor"><p>当前角色：{names[selected.role]}</p><FormField label="新的平台角色"><select value={target} onChange={(event) => { setTarget(event.target.value as DemoRole); setConfirm(false); }}>{Object.entries(names).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></FormField><p>{descriptions[target]}</p>
      {ownerBlock ? <ActionNote tone="error">林晓仍是“客户回访助手”的负责人。请先转交项目负责人，再降为用户。</ActionNote> : lastAdmin ? <ActionNote tone="error">平台必须保留至少一名管理员，请先指定另一名管理员。</ActionNote> : null}
      {confirm ? <ConfirmationPanel question={`将 ${selected.name} 从${names[selected.role]}改为${names[target]}？`} hint={target === 'user' ? '该账号将不能进入项目开发和平台管理，应用使用资格仍按应用授权保留。' : '平台角色不会自动授予所有项目的成员资格。'} confirmLabel="确认修改" cancelLabel="继续选择" onConfirm={() => { setUsers((items) => items.map((user) => user.email === editing ? { ...user, role: target } : user)); setMessage(`${selected.name} 的角色已改为${names[target]}（模拟）。`); setEditing(undefined); setConfirm(false); }} onCancel={() => setConfirm(false)} /> : <ActionRow><Button variant="primary" disabled={target === selected.role || ownerBlock || lastAdmin} onClick={() => setConfirm(true)}>保存角色</Button><Button onClick={() => setEditing(undefined)}>取消</Button></ActionRow>}
    </Card> : null}
  </>;
}

export function AdministrationDemo({ path, go }: { path: string; go(path: string): void }) {
  const users = path === '/admin/users';
  return <><PageHeader title={users ? '用户与角色' : '平台管理'} description={users ? '为团队成员分配适合其职责的平台角色。' : '管理平台供给，让团队安心使用和开发应用。'} actions={users ? <Button onClick={() => go('/admin')}>返回平台管理</Button> : undefined} />
    {users ? <RoleDirectoryDemo /> : <div className="adminGrid">
      <Card stacked title="用户与角色"><p>管理用户、开发者和管理员三类身份。</p><ActionRow><Button onClick={() => go('/admin/users')}>管理用户</Button></ActionRow></Card>
      <Card stacked title="平台资源"><p>算力档位、资源套餐与接入能力。</p><p className="muted">沿用现有管理页面，本次只调整入口。</p></Card>
      <Card stacked title="项目管理"><p>管理全部项目、指定负责人和处理开通问题。</p><p className="muted">代建项目和资源分配保留在这里。</p></Card>
    </div>}
  </>;
}
