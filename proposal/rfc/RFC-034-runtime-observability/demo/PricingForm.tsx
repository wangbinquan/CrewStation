import { Stack } from '../../../../apps/console/src/shared/ui/Stack';
import { FormField } from '../../../../apps/console/src/shared/ui/FormField';
import { DefinitionList } from '../../../../apps/console/src/shared/ui/DefinitionList';
import { FormDialog } from '../../../../apps/console/src/shared/ui/dialog/FormDialog';
import { Notice } from './Metrics';
import { pricingProfiles, rateFields } from './pricingCatalog';
import type { PricingKey, RateDraft } from './pricingCatalog';

interface Props {
  pricingKey: PricingKey; draft: RateDraft; error: string | null; dirty: boolean;
  onDraft: (draft: RateDraft) => void; onClose: () => void; onClear: () => void; onSave: () => void;
}
export function PricingForm({ pricingKey, draft, error, dirty, onDraft, onClose, onClear, onSave }: Props) {
  const profile = pricingProfiles.find((p) => p.key === pricingKey)!;
  return <FormDialog title={'新增 Token 价格版本 · ' + profile.name} size="large" submitLabel="保存演示版本" cancelLabel="取消"
    onSubmit={onSave} onClose={onClose} onClear={onClear} dirty={dirty} error={error}>
    <Stack>
      <Notice>保存后仅影响生效时间之后新受理的执行；历史费用仍按已绑定的价格版本计算。</Notice>
      <DefinitionList items={[{ label: '运行时', value: profile.runtime }, { label: '模型服务', value: profile.provider }, { label: '模型', value: profile.model }, { label: '币种与单位', value: '人民币（CNY）· 元 / 百万 Token' }]}/>
      <div className="pricingFields">{rateFields.map(({ key, label }) => <FormField key={key} label={label + '单价'} hint="元 / 百万 Token；明确免费请填 0">
        <input type="text" inputMode="decimal" value={draft[key]} onChange={(e) => onDraft({ ...draft, [key]: e.target.value })}/>
      </FormField>)}</div>
      <FormField label="生效时间" hint="UTC+08:00；必须晚于演示快照及已有版本。"><input type="datetime-local" step="60" value={draft.effectiveAt} onInput={(e) => onDraft({ ...draft, effectiveAt: e.currentTarget.value })}/></FormField>
      <p className="muted small">金额直接录入人民币采购单价。本原型仅在当前页面会话中保存，刷新后恢复示例；不会改变真实配置。</p>
    </Stack>
  </FormDialog>;
}
