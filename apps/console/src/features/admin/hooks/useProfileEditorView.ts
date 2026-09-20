import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { DraftErrors } from '../model/stepDraft';
import type { ProfileDraftHandle } from './useProfileDraft';
import type { SaveNote } from './useProfileSave';

export const EDITOR_SECTIONS = ['basics', 'startup', 'variables', 'test'] as const;
export type EditorSection = typeof EDITOR_SECTIONS[number];

export function sectionForError(field: string): EditorSection {
  if (field.startsWith('steps.') || field === 'configFilePath') return 'startup';
  if (field.startsWith('vars.') || field.startsWith('secrets.')) return 'variables';
  if (['testCommand', 'testExpect', 'testTimeoutSeconds'].includes(field)) return 'test';
  return 'basics';
}

/** 分组仅切换可见性，草稿与测试轮询始终保留；定位等目标分组和步骤渲染后再转移焦点。 */
export function useProfileEditorView(editor: ProfileDraftHandle, root: RefObject<HTMLDivElement | null>) {
  const [view, setView] = useState<{ section: EditorSection; focus?: 'error' | 'step' }>({ section: 'basics' });
  useLayoutEffect(() => {
    if (!view.focus) return;
    const panel = root.current?.querySelector<HTMLElement>('[data-editor-section]:not([hidden])');
    const selector = view.focus === 'error' ? '[aria-invalid="true"]' : '[data-step-editor] input';
    panel?.querySelector<HTMLElement>(selector)?.focus();
  }, [view, root]);
  const select = (section: string) => { if (EDITOR_SECTIONS.includes(section as EditorSection)) setView({ section: section as EditorSection }); };
  const selectStep = (index: number) => { editor.setSelected(index); setView({ section: 'startup', focus: 'step' }); };
  const onInvalid = (errors: DraftErrors) => {
    const field = Object.keys(errors)[0];
    if (!field) return;
    const match = field.match(/^steps\.(\d+)\./);
    if (match) editor.setSelected(Number(match[1]));
    setView({ section: sectionForError(field), focus: 'error' });
  };
  const onSaved = (note: SaveNote) => { if (note.kind === 'revision') select('test'); };
  const locate = (stepId: string) => {
    const index = editor.draft.steps.findIndex((step) => step.stepId === stepId);
    if (index >= 0) selectStep(index);
  };
  return { section: view.section, select, selectStep, locate, onInvalid, onSaved };
}
