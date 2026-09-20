import { useState } from 'react';
import type { ProfileDraft } from '../model/profileDraft';
import { draftDirty, validateProfileDraft } from '../model/profileDraft';
import type { DraftErrors, StepDraft } from '../model/stepDraft';
import { duplicateStep, moveStep, newStep } from '../model/stepDraft';

/** 档位草稿：字段修改、步骤增删改序、凭据操作；保存冲突时保留草稿只更新基线修订号。 */
export function useProfileDraft(initial: ProfileDraft, initialRevision: number | undefined) {
  const [draft, setDraft] = useState(initial);
  const [base, setBase] = useState(initial);
  const [baseRevision, setBaseRevision] = useState(initialRevision);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [selected, setSelected] = useState<number | null>(initial.steps.length ? 0 : null);
  const update = (fn: (d: ProfileDraft) => ProfileDraft) => { setDraft((d) => fn(d)); setErrors({}); };
  const changeStep = (index: number, patch: Partial<StepDraft>) => update((d) => ({ ...d, steps: d.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  return {
    draft, errors, selected, baseRevision, dirty: draftDirty(draft, base),
    setSelected, update, changeStep,
    addStep: (kind: StepDraft['kind']) => { update((d) => ({ ...d, steps: [...d.steps, newStep(kind, d.steps)] })); setSelected(draft.steps.length); },
    removeStep: (index: number) => { update((d) => ({ ...d, steps: d.steps.filter((_, i) => i !== index) })); setSelected((s) => (s === null ? null : s === index ? null : s > index ? s - 1 : s)); },
    moveStep: (index: number, delta: -1 | 1) => { update((d) => ({ ...d, steps: moveStep(d.steps, index, delta) })); setSelected(index + delta); },
    duplicateStep: (index: number) => { update((d) => ({ ...d, steps: duplicateStep(d.steps, index) })); setSelected(index + 1); },
    validate: (creating: boolean): DraftErrors => { const found = validateProfileDraft(draft, creating); setErrors(found); return found; },
    /** 保存成功或选择放弃后，以服务端最新详情重建基线。 */
    reload: (next: ProfileDraft, revision: number) => { setDraft(next); setBase(next); setBaseRevision(revision); setErrors({}); setSelected(next.steps.length ? 0 : null); },
    /** 冲突：保留当前草稿，只把期望修订换成服务端当前值，让管理员对照后再保存。 */
    adoptRevision: (revision: number) => setBaseRevision(revision),
  };
}

export type ProfileDraftHandle = ReturnType<typeof useProfileDraft>;
