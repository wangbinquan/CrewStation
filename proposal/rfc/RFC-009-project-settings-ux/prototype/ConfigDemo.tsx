import { useEffect, useRef, useState } from 'react';
import { ActionNote } from '../../../../apps/console/src/shared/ui/ActionNote';
import { ActionRow } from '../../../../apps/console/src/shared/ui/ActionRow';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { ConfirmationPanel } from '../../../../apps/console/src/shared/ui/ConfirmationPanel';
import { FormField } from '../../../../apps/console/src/shared/ui/FormField';
import { Stack } from '../../../../apps/console/src/shared/ui/Stack';
import { Tabs } from '../../../../apps/console/src/shared/ui/Tabs';
import type { DemoRole } from './entry';

type Env = 'development' | 'production';
interface Variable { name: string; value: string; secret: boolean }
interface Draft extends Variable { editing?: string }
interface PendingChange { question: string; hint: string; confirm: string; run: () => void }
const labels = { development: '开发', production: '生产' };
const examples: Record<Env, Variable[]> = { development: [{ name: 'GREETING', value: '你好，欢迎使用演示数字人', secret: false }, { name: 'API_TOKEN', value: '', secret: true }], production: [{ name: 'GREETING', value: '欢迎使用团队工作台', secret: false }] };
interface ConfigProps { role: DemoRole; fail: boolean; onDirty: (dirty: boolean) => void; onGuide: () => void }
export function ConfigDemo({ role, fail, onDirty, onGuide }: ConfigProps) {
  const [env, setEnv] = useState<Env>('development'), [values, setValues] = useState(examples);
  const [drafts, setDrafts] = useState<Partial<Record<Env, Draft>>>({}), [versions, setVersions] = useState({ development: 7, production: 4 });
  const [changed, setChanged] = useState<Partial<Record<Env, boolean>>>({}), [receipt, setReceipt] = useState('');
  const [error, setError] = useState(''), [pending, setPending] = useState<PendingChange>();
  const opener = useRef<HTMLElement | null>(null);
  const editable = env === 'development' || role !== 'developer', draft = drafts[env];
  useEffect(() => { onDirty(Boolean(changed.development || changed.production)); }, [changed, onDirty]);
  const open = (item?: Variable) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const next = () => { setDrafts((all) => ({ ...all, [env]: item ? { ...item, value: item.secret ? '' : item.value, editing: item.name } : { name: '', value: '', secret: false } })); setChanged((all) => ({ ...all, [env]: false })); setReceipt(''); setError(''); };
    if (changed[env]) setPending({ question: `放弃${labels[env]}环境的当前草稿？`, hint: `确认后将打开${item ? `变量 ${item.name}` : '新增变量表单'}，另一环境的草稿保留。`, confirm: '放弃并打开', run: next }); else next();
  };
  const close = () => { setDrafts((all) => ({ ...all, [env]: undefined })); setChanged((all) => ({ ...all, [env]: false })); setError(''); setTimeout(() => opener.current?.focus(), 0); };
  const save = () => {
    if (!draft || !editable) return;
    if (fail) { setError('保存失败：服务暂时不可用（HTTP 503）。输入已保留，可以重试。'); return; }
    const item = { name: draft.name.trim(), value: draft.secret ? '' : draft.value, secret: draft.secret };
    setValues((all) => ({ ...all, [env]: [...all[env].filter((row) => row.name !== item.name), item] }));
    setVersions((all) => ({ ...all, [env]: all[env] + 1 }));
    setReceipt(`已保存${labels[env]}变量 ${item.name}，第 ${versions[env] + 1} 版（演示）。${env === 'development' ? '新任务容器创建时注入，现有进程不会自动加载。' : '后续发布采用新配置，现有正式与待验证版本不变。'}`); close();
  };
  const remove = (name: string) => setPending({ question: `删除${labels[env]}变量 ${name}？`, hint: '不会立即改变现有进程；新的配置在后续注入时采用。', confirm: `确认删除 ${name}`, run: () => {
    if (fail) { setError('删除失败：服务暂时不可用（HTTP 503），原变量仍保留。'); return; }
    setValues((all) => ({ ...all, [env]: all[env].filter((item) => item.name !== name) })); setVersions((all) => ({ ...all, [env]: all[env] + 1 })); setReceipt(`已删除${labels[env]}变量 ${name}（演示）。新配置在后续注入时生效。`);
  } });
  return <Stack><div className="sectionHeading"><h2>环境变量</h2><p className="muted">为应用配置运行参数；需要保密的值可设为密钥。</p></div>
    <Tabs label="配置环境" value={env} items={[{ value: 'development', label: '开发' }, { value: 'production', label: '生产' }]} onChange={(value) => { setEnv(value as Env); setReceipt(''); setError(''); }}>
      <Stack><div className="contextLine"><Badge tone={env === 'development' ? 'info' : 'warning'}>{env === 'development' ? '仅开发环境' : '正式与待验证版本共用'}</Badge><span>{env === 'development' ? '新任务容器创建时注入；现有进程不会自动加载。' : '后续发布采用新值；保存不会改变当前运行版本。'}</span></div>
        {!editable ? <ActionNote tone="neutral">当前为只读。生产变量由项目负责人或平台管理员维护。</ActionNote> : null}
        <Card compact stacked title={`${labels[env]}变量`} extra={editable ? <Button variant="primary" onClick={() => open()}>新增变量</Button> : <Badge>只读</Badge>}>
          {values[env].length ? <div className="variableList">{values[env].map((item) => <div className="variableRow" key={item.name}><div><code>{item.name}</code><div className="muted">{item.secret ? '密钥' : '普通变量'}</div></div><div className="variableValue">{item.secret ? <span className="muted">已设置 · 无法读取</span> : item.value || <span className="muted">空字符串</span>}</div>{editable ? <ActionRow><Button onClick={() => open(item)}>{item.secret ? '更新密钥' : '修改'}</Button><Button variant="ghost" aria-label={`删除 ${item.name}`} onClick={() => remove(item.name)}>删除</Button></ActionRow> : null}</div>)}</div> : <p className="muted">还没有变量。按应用需要添加，平台自动提供的连接信息见开发资源。</p>}
        </Card>
        {pending ? <ConfirmationPanel question={pending.question} hint={pending.hint} confirmLabel={pending.confirm} cancelLabel="取消" onConfirm={() => { pending.run(); setPending(undefined); }} onCancel={() => setPending(undefined)} /> : null}
        {draft && editable ? <VariableEditor key={`${env}:${draft.editing ?? 'new'}`} env={env} draft={draft} names={values[env].map((item) => item.name)} onChange={(next) => { setDrafts((all) => ({ ...all, [env]: next })); setChanged((all) => ({ ...all, [env]: true })); }} onSave={save} onCancel={() => changed[env] ? setPending({ question: `放弃${labels[env]}环境的当前草稿？`, hint: '另一环境的草稿保留。', confirm: '放弃并关闭编辑', run: close }) : close()} /> : null}
        {error ? <ActionNote tone="error">{error}</ActionNote> : null}{receipt ? <ActionNote tone="success">{receipt}</ActionNote> : null}
        {env === 'production' ? <details><summary>发布配置对照 · {versions.production > 4 ? '有尚未发布的配置' : '与当前发布记录一致'}</summary><p className="detailContent">正式 v0.1.2 与待验证 v0.1.4 均记录为配置第 4 版；当前已保存第 {versions.production} 版（模拟）。</p></details> : null}
        <details><summary>版本记录 · 当前第 {versions[env]} 版</summary><div className="detailContent"><p>第 {versions[env]} 版 · 演示记录</p><p className="muted">正式界面保留版本、键名、修改人与时间；记录读取失败在这里重试。</p></div></details>
        <ActionRow><span className="muted">寻找数据库地址或平台自动注入的变量？</span><Button variant="ghost" onClick={onGuide}>查看平台接入说明 →</Button></ActionRow>
      </Stack>
    </Tabs>
  </Stack>;
}

function VariableEditor({ env, draft, names, onChange, onSave, onCancel }: { env: Env; draft: Draft; names: string[]; onChange: (draft: Draft) => void; onSave: () => void; onCancel: () => void }) {
  const [invalid, setInvalid] = useState(false), field = useRef<HTMLInputElement>(null);
  useEffect(() => { field.current?.focus(); }, []);
  return <Card compact stacked title={`${draft.editing ? `修改 ${draft.editing}` : '新增变量'} · ${labels[env]}`}>
    <form className="editorForm" noValidate onSubmit={(event) => { event.preventDefault(); if (!/^[A-Z][A-Z0-9_]*$/.test(draft.name.trim())) { setInvalid(true); field.current?.focus(); } else { setInvalid(false); onSave(); } }}>
      <FormField label="变量名" hint="大写字母开头，只能包含大写字母、数字和下划线。" hintId="variable-name-hint" error={invalid ? '请输入有效变量名，例如 API_BASE_URL。' : undefined} errorId="variable-name-error"><input ref={field} value={draft.name} aria-invalid={invalid} aria-describedby="variable-name-hint" aria-errormessage={invalid ? 'variable-name-error' : undefined} onChange={(event) => { onChange({ ...draft, name: event.target.value }); setInvalid(false); }} placeholder="例如 API_BASE_URL" /></FormField>
      <FormField label="类型"><select value={draft.secret ? 'secret' : 'plain'} onChange={(event) => onChange({ ...draft, secret: event.target.value === 'secret' })}><option value="plain">普通变量</option><option value="secret">密钥 · 保存后无法读取</option></select></FormField>
      <FormField label={draft.secret ? '新的密钥值' : '值'} hint={draft.secret ? '旧密钥无法读回。留空保存会用空字符串覆盖，不是保留旧密钥。' : '允许空字符串；留空保存会写入空值，不是保留原值。'}><input type={draft.secret ? 'password' : 'text'} autoComplete="off" value={draft.value} onChange={(event) => onChange({ ...draft, value: event.target.value })} /></FormField>
      {names.includes(draft.name.trim()) ? <p className="muted">保存将覆盖 {draft.name.trim()}，并生成新版本。</p> : null}
      <ActionRow><Button variant="primary" type="submit">保存到{labels[env]}</Button><Button onClick={onCancel}>取消编辑</Button><span className="muted">切换开发／生产会保留草稿</span></ActionRow>
    </form>
  </Card>;
}
