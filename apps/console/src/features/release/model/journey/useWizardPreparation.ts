import { useEffect, useRef, useState } from 'react';
import { onlineManager } from '@tanstack/react-query';
import { ReleaseDtoSchema, ReleaseJourneyDetailSchema, ReleaseJourneyPageSchema, WorkspaceStatusDtoSchema } from '@crewstation/contracts';
import type { PublishDevSessionInput } from '@crewstation/api-client';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { errorMessage, isApiClientError, useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import type { PublishSource } from '../../../../shared/project/releaseSearch';
import { repositoryPublishSnapshot, sessionPublishSnapshot } from '../publishSource';
import { candidateReleaseTag } from '../releaseVersion';
import { acceptedIntentMatches } from './preparation';
import { readWizardStorage, removeWizardStorage, saveWizardStorage, WizardDraftSchema, wizardStorageKey } from './storage';
import type { PublishIntent, WizardDraft } from './storage';

interface Input { projectId: string; serviceId: string; userId: string; space: string; draftId: string; source: PublishSource; canPublish: boolean; onAccepted(id: string): void }
export function useWizardPreparation(input: Input) {
  const t = useT(), locked = useRef(false), key = wizardStorageKey(input.userId, input.space, input.projectId, input.draftId);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [draft, setDraft] = useState<WizardDraft>(() => readWizardStorage(key, WizardDraftSchema) ?? { version: 1, source: input.source, branch: '', tag: '', message: '' });
  const [saved, setSaved] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const set = (patch: Partial<WizardDraft>) => { const next = { ...draft, ...patch }; setSaved(saveWizardStorage(key, next)); setDraft(next); };
  const branches = useApiQuery([...queryKeys.branches(input.projectId), 'wizard'], () => api.services.listBranches(input.serviceId), { enabled: draft.source === 'repository', refetchIntervalMs: 30_000 });
  const workspace = useApiQuery([...queryKeys.devSession(input.projectId), 'workspace-status'], async () => WorkspaceStatusDtoSchema.parse(await api.devSession.workspaceStatus(input.projectId)), { enabled: draft.source === 'session', refetchIntervalMs: 30_000 });
  const tags = useApiQuery(queryKeys.tags(input.serviceId), () => api.services.listTags(input.serviceId), { refetchIntervalMs: 30_000 });
  const selected = draft.branch || branches.data?.items.find(branch => branch.isDefault)?.name || branches.data?.items[0]?.name || '';
  const checked = draft.source === 'repository' ? repositoryPublishSnapshot(branches.data?.items ?? [], selected, new Date().toISOString()) : workspace.data ? sessionPublishSnapshot(workspace.data) : undefined;
  const snapshot = checked?.snapshot;
  const candidate = candidateReleaseTag(tags.data?.items.map(tag => tag.name) ?? [], draft.tag.trim() || 'patch');
  const versionError = !candidate || draft.tag.length > 80 ? t('release.publish.versionInvalid') : undefined;
  const messageError = draft.message.length > 500 ? t('release.prepare.messageInvalid') : undefined;
  const queryError = tags.error ?? (draft.source === 'repository' ? branches.error : workspace.error);
  const pending = tags.isPending || (draft.source === 'repository' ? branches.isPending : workspace.isPending);
  const accept = async (id: string, intent: PublishIntent) => {
    const detail = ReleaseJourneyDetailSchema.parse(await api.services.getReleaseJourney(id));
    if (!acceptedIntentMatches(detail, intent, input.serviceId, input.projectId)) throw new Error(t('release.wizard.receiptMismatch'));
    if (mounted.current) { removeWizardStorage(key); input.onAccepted(id); }
  };
  const submit = async () => {
    if (locked.current || !input.canPublish || draft.intent || !snapshot || !candidate || versionError || messageError || pending || queryError) return;
    if (!onlineManager.isOnline()) { setError(t('ui.connection.notSent')); return; }
    if (tags.data?.items.some(tag => tag.name === candidate)) { setError(t('release.prepare.tagExists')); return; }
    const intent: PublishIntent = { tag: candidate, branch: snapshot.branch, commitSha: snapshot.commitSha, source: draft.source, actorId: input.userId, message: draft.message, ...(snapshot.taskId ? { taskId: snapshot.taskId } : {}) };
    const stored = saveWizardStorage(key, { ...draft, intent }); setSaved(stored);
    if (!stored) { setError(t('release.wizard.publishStorageRequired')); return; }
    locked.current = true; setBusy(true); setError(undefined); setDraft({ ...draft, intent });
    let accepted = false;
    try {
      const request: PublishDevSessionInput = { version: intent.tag, branch: intent.branch, expectedCommitSha: intent.commitSha, ...(intent.taskId ? { expectedTaskId: intent.taskId } : {}), ...(intent.message.trim() ? { message: intent.message.trim() } : {}) };
      const response = ReleaseDtoSchema.parse(await (intent.source === 'session' ? api.devSession.publish(input.projectId, request) : api.services.publish(input.serviceId, request)));
      accepted = true;
      if (!response.journeyId || response.serviceId !== input.serviceId || response.tag !== intent.tag || response.commitSha !== intent.commitSha) throw new Error(t('release.prepare.responseUnknown'));
      await accept(response.journeyId, intent);
    } catch (cause) {
      const notAccepted = !accepted && isApiClientError(cause) && (cause.details.requestSent === false || cause.status >= 400 && cause.status < 500);
      if (notAccepted) set({ intent: undefined });
      setError(errorMessage(cause));
    } finally { locked.current = false; setBusy(false); }
  };
  const recover = async () => {
    if (locked.current || !draft.intent) return;
    locked.current = true; setBusy(true); setError(undefined);
    try {
      let cursor: string | undefined;
      do {
        const page = ReleaseJourneyPageSchema.parse(await api.services.listReleaseJourneys(input.serviceId, { tag: draft.intent.tag, limit: 50, cursor }));
        const match = page.items.find(item => item.recordKind === 'journey' && acceptedIntentMatches(item, draft.intent!, input.serviceId, input.projectId));
        if (match?.recordKind === 'journey') { await accept(match.id, draft.intent); return; }
        cursor = page.nextCursor;
      } while (cursor);
      setError(t('release.wizard.acceptanceUnknown'));
    } catch (cause) { setError(errorMessage(cause)); }
    finally { locked.current = false; setBusy(false); }
  };
  return { draft, set, saved, busy, error, branches, workspace, selected, snapshot, candidate, versionError, messageError, queryError, pending,
    problem: checked?.problem, submit, recover, clear: () => { if (!busy && !draft.intent) { removeWizardStorage(key); set({ tag: '', message: '', branch: '' }); } } };
}
