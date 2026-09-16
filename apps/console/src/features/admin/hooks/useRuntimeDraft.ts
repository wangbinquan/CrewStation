import { useState } from 'react';
import type { RuntimeConfigDetailDto } from '@crewstation/contracts';
import type { DraftErrors, RuntimeDraft, StepDraft } from '../model/runtimeDraft';
import { draftDirty, draftFromRevision, duplicateStep, moveStep, newStep, validateDraft } from '../model/runtimeDraft';

/** 草稿状态：字段修改、步骤增删改序、凭据操作；保存冲突时保留草稿只更新基线版本号。 */
export function useRuntimeDraft(detail: RuntimeConfigDetailDto) {
  const [draft, setDraft] = useState(() => draftFromRevision(detail));
  const [base, setBase] = useState(() => draftFromRevision(detail));
  const [baseRevision, setBaseRevision] = useState(detail.draftRevision);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [selected, setSelected] = useState<number | null>(detail.draft.steps.length ? 0 : null);
  const update = (fn: (d: RuntimeDraft) => RuntimeDraft) => { setDraft((d) => fn(d)); setErrors({}); };
  const changeStep = (index: number, patch: Partial<StepDraft>) => update((d) => ({ ...d, steps: d.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  return {
    draft, errors, selected, baseRevision, dirty: draftDirty(draft, base),
    setSelected, update, changeStep,
    addStep: (kind: StepDraft['kind']) => { update((d) => ({ ...d, steps: [...d.steps, newStep(kind, d.steps)] })); setSelected(draft.steps.length); },
    removeStep: (index: number) => { update((d) => ({ ...d, steps: d.steps.filter((_, i) => i !== index) })); setSelected((s) => (s === null ? null : s === index ? null : s > index ? s - 1 : s)); },
    moveStep: (index: number, delta: -1 | 1) => { update((d) => ({ ...d, steps: moveStep(d.steps, index, delta) })); setSelected(index + delta); },
    duplicateStep: (index: number) => { update((d) => ({ ...d, steps: duplicateStep(d.steps, index) })); setSelected(index + 1); },
    validate: (): boolean => { const found = validateDraft(draft); setErrors(found); return Object.keys(found).length === 0; },
    /** 保存成功或选择放弃后，以服务端最新详情重建基线。 */
    reload: (next: RuntimeConfigDetailDto) => { const value = draftFromRevision(next); setDraft(value); setBase(value); setBaseRevision(next.draftRevision); setErrors({}); setSelected(next.draft.steps.length ? 0 : null); },
    /** 冲突：保留当前草稿，只把期望版本换成服务端当前值，让管理员对照后再保存。 */
    adoptRevision: (revision: number) => setBaseRevision(revision),
  };
}
