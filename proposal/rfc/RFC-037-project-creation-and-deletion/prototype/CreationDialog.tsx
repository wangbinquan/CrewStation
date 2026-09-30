import { useRef, useState } from 'react';
import { FormDialog } from '../../../../apps/console/src/shared/ui/dialog/FormDialog';
import { FormField } from '../../../../apps/console/src/shared/ui/FormField';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { ActionNote } from '../../../../apps/console/src/shared/ui/ActionNote';
import { Stack } from '../../../../apps/console/src/shared/ui/Stack';
import { DEMO_DOMAIN, TEMPLATES, initialDraft, validSlug } from './model';
import type { Draft } from './model';

interface Props { draft: Draft; setDraft(draft: Draft): void; admin: boolean; onClose(): void }

export function CreationDialog({ draft, setDraft, admin, onClose }: Props) {
  const first = useRef<HTMLInputElement>(null), slugInput = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<{ name?: string; slug?: string }>({}), [checked, setChecked] = useState(false);
  const slug = draft.slug.trim(), valid = validSlug(slug), template = TEMPLATES.find((item) => item.id === draft.template) ?? TEMPLATES[0];
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft());
  const update = (field: keyof Draft, value: string) => { setDraft({ ...draft, [field]: value }); setErrors({}); setChecked(false); };
  const submit = () => {
    const next = { ...(!draft.name.trim() ? { name: '请输入项目名称，用于项目列表展示。' } : {}), ...(!valid ? { slug: '请填写 3–40 位小写字母、数字或短横线，以字母开头、字母或数字结尾；不能使用平台保留名。' } : {}) };
    setErrors(next);
    if (next.name) first.current?.focus(); else if (next.slug) slugInput.current?.focus(); else setChecked(true);
  };
  return <FormDialog title="新建项目" size="large" submitLabel="创建项目" onSubmit={submit} onClose={onClose} initialFocus={first}
    dirty={dirty} onClear={() => { setDraft(initialDraft()); setErrors({}); setChecked(false); }}>
    <div className="creation-content">
      <p className="dialog-intro">确定项目名称与访问地址，选择初始代码，就可以开始开发。</p>
      <section className="creation-section">
        <div className="section-heading"><h3>项目与访问地址</h3><span>先决定应用叫什么、从哪里访问</span></div>
        <div className="creation-grid">
          <FormField label="项目名称" hint="用于项目列表展示，可以填写中文。" hintId="name-hint" error={errors.name} errorId="name-error">
            <input ref={first} name="name" value={draft.name} placeholder="例如：周报助手" maxLength={80} aria-invalid={!!errors.name} aria-describedby="name-hint name-error" onChange={(event) => update('name', event.target.value)} />
          </FormField>
          <FormField label="域名标识" hint="决定下方访问域名；创建后不能修改。" hintId="slug-hint" error={errors.slug} errorId="slug-error">
            <input ref={slugInput} name="slug" value={draft.slug} placeholder="例如：weekly-report" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={40} aria-invalid={!!errors.slug} aria-describedby="slug-hint slug-error slug-format" onChange={(event) => update('slug', event.target.value)} />
          </FormField>
        </div>
        <p id="slug-format" className="field-format">标识为 3–40 位小写字母、数字或短横线，以字母开头、字母或数字结尾。</p>
        <div className="domain-preview" aria-live="polite">
          <div className="domain-heading"><strong>创建后的访问域名</strong><Badge tone="info">{valid ? '随标识更新' : '填写标识后预览'}</Badge></div>
          {valid ? <div className="domain-grid">
            <div><span className="domain-label">正式访问</span><code>{slug}.{DEMO_DOMAIN}</code><small>手动上线后供用户使用</small></div>
            <div><span className="domain-label">待验证访问</span><code>preview.{slug}.{DEMO_DOMAIN}</code><small>开通后先在这里验收</small></div>
          </div> : <p className="domain-empty">{slug ? '标识格式还不正确，修正后会显示完整域名。' : '输入域名标识，即可看到应用的完整访问地址。'}</p>}
        </div>
        {admin ? <FormField label="项目负责人" hint="负责项目开发、成员管理与上线。" hintId="owner-hint">
          <select name="owner" value={draft.owner} aria-describedby="owner-hint" onChange={(event) => update('owner', event.target.value)}>
            <option value="me">我（当前管理员）</option><option value="lin">李琳 · 开发者</option><option value="chen">陈舟 · 开发者</option>
          </select>
        </FormField> : <p className="owner-line">项目负责人 <strong>我（当前用户）</strong><span>你将负责开发、成员管理与上线。</span></p>}
      </section>
      <section className="creation-section template-section">
        <div className="section-heading"><h3>初始代码</h3><span>模板决定项目从什么代码开始</span></div>
        <div className="template-grid">
          <FormField label="应用模板" hint="用于生成初始代码与发布配置，创建后可以继续开发修改。" hintId="template-hint">
            <select name="template" value={draft.template} aria-describedby="template-hint" onChange={(event) => update('template', event.target.value)}>
              {TEMPLATES.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
          </FormField>
          <div className="template-detail"><div><strong>{template.name}</strong><Badge>{template.tag}</Badge></div><p>{template.description}</p>
            <div className="template-items">{template.items.map((item) => <span key={item}>✓ {item}</span>)}</div>
          </div>
        </div>
      </section>
      <section className="resource-section">
        <details><summary><span>资源设置 <span className="optional-label">{admin ? '可选' : '平台默认'}</span></span><span className="resource-default">{draft.plan === 'standard' ? '标准套餐' : '默认套餐'} · 最多 {draft.quota} 个并发任务</span></summary>
          <div className="resource-fields">{admin ? <div className="creation-grid">
            <FormField label="服务资源套餐" hint="决定首次发布的服务规格。"><select name="plan" value={draft.plan} onChange={(event) => update('plan', event.target.value)}><option value="default">平台默认套餐</option><option value="standard">标准套餐（演示）</option></select></FormField>
            <FormField label="任务并发上限" hint="限制同时运行的任务数量。"><input name="quota" type="number" min={1} max={100} value={draft.quota} onChange={(event) => update('quota', event.target.value)} /></FormField>
          </div> : <p>新项目使用平台默认资源。如需调整，创建后由管理员在项目资源配置中处理。</p>}</div>
        </details>
      </section>
      <p className="creation-next"><span aria-hidden="true">↗</span><span>创建后平台会建立仓库并自动开通。<strong>先在待验证地址验收，再手动上线。</strong></span></p>
      {checked ? <Stack><ActionNote tone="success">表单预览检查通过。此交互稿不会创建真实项目。</ActionNote></Stack> : null}
    </div>
  </FormDialog>;
}
