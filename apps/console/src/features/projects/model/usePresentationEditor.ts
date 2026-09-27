import type { AppIcon, AppIconSource, AppPresentationDto, SetAppPresentationRequest } from '@crewstation/contracts';
import { APP_ICON_MAX_BYTES, AppIconUrlSchema } from '@crewstation/contracts';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { useApiMutation } from '../../../shared/api/useApi';

export function usePresentationEditor(projectId: string, saved: AppPresentationDto, reload: () => Promise<unknown>, canSave: boolean, onSaved?: () => void) {
  const [draft, setDraft] = useState(saved), [base, setBase] = useState(saved), [invalid, setInvalid] = useState(false);
  const [file, setFile] = useState<File>(), [fileError, setFileError] = useState(false), [preview, setPreview] = useState<string>();
  const lock = useRef(false), source = draft.iconSource ?? { kind: 'app' as const };
  const dirty = !!file || draft.description !== base.description || draft.icon !== base.icon || JSON.stringify(draft.iconSource) !== JSON.stringify(base.iconSource);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const save = useApiMutation((input: SetAppPresentationRequest) => file ? api.projects.uploadAppIcon(projectId, input, file) : api.projects.setAppPresentation(projectId, input), {
    invalidate: [['market']], onSuccess: (value) => { setDraft(value); setBase(value); setFile(undefined); setPreview(undefined); void reload(); onSaved?.(); },
  });
  if (!dirty && !save.isPending && saved.revision > base.revision) { setDraft(saved); setBase(saved); }
  const conflict = saved.revision > base.revision;
  const missingFile = source.kind === 'upload' && source.revision === 0 && !file;
  const invalidUrl = source.kind === 'url' && (!AppIconUrlSchema.safeParse(source.url).success || location.protocol === 'https:' && /^http:/i.test(source.url.trim()));
  const submit = (root: ParentNode) => {
    if (!canSave || conflict || lock.current || invalidUrl || fileError || missingFile) return;
    if (draft.description.trim().length > 400) { setInvalid(true); root.querySelector('textarea')?.focus(); return; }
    setInvalid(false); lock.current = true;
    const iconSource = !file && source.kind !== 'upload' ? source : undefined;
    void save.mutateAsync({ description: draft.description, icon: draft.icon, ...(iconSource ? { iconSource } : {}), expectedRevision: base.revision }).catch(() => { void reload(); }).finally(() => { lock.current = false; });
  };
  return {
    projectId, draft, dirty, invalid, save, submit, conflict, source, file, preview, fileError, invalidUrl,
    canSubmit: canSave && !conflict && !save.isPending && !invalidUrl && !fileError && !missingFile,
    canRebase: canSave && !save.isPending,
    describe: (description: string) => { setDraft({ ...draft, description }); save.reset(); setInvalid(false); },
    chooseIcon: (icon: AppIcon) => { setDraft({ ...draft, icon }); save.reset(); },
    chooseSource: (iconSource: AppIconSource) => { setDraft({ ...draft, iconSource }); setFile(undefined); setPreview(undefined); setFileError(false); save.reset(); },
    chooseFile: (value: File) => { const valid = value.size > 0 && value.size <= APP_ICON_MAX_BYTES && ['image/png', 'image/jpeg', 'image/webp'].includes(value.type); setFileError(!valid); if (valid) { setFile(value); setPreview(URL.createObjectURL(value)); } save.reset(); },
    cancel: () => { if (!lock.current) { setDraft(saved); setBase(saved); setFile(undefined); setPreview(undefined); setFileError(false); setInvalid(false); save.reset(); } },
    rebaseDraft: () => { if (canSave && !lock.current) { setBase({ ...base, revision: saved.revision }); save.reset(); } },
  };
}
