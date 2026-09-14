import { useEffect, useRef, useState } from 'react';
import { ReleaseDtoSchema, WorkspaceStatusDtoSchema } from '@crewstation/contracts';
import type { PublishDevSessionInput } from '@crewstation/api-client';
import type { ReleaseDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, isApiClientError, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import type { PublishSource } from '../../../shared/project/releaseSearch';
import { candidateReleaseTag, isPublishVersion } from './releaseVersion';
import { publishSourceStillMatches, repositoryPublishSnapshot, sessionPublishSnapshot } from './publishSource';
import type { PublishSnapshot } from './publishSource';
import { uncommittedPaths } from './publishPrecondition';
import type { ReleaseActions } from './useReleaseActions';

export function usePublishPreparation(projectId: string, serviceId: string, source: PublishSource, canPublish: boolean, actions: ReleaseActions, onAccepted: (release: ReleaseDto) => void) {
  const t = useT(), lock = useRef(false), accepted = useRef(false), mounted = useRef(true);
  const [complete, setComplete] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [branch, setBranch] = useState(''), [version, setVersion] = useState('patch'), [message, setMessage] = useState('');
  const [snapshot, setSnapshot] = useState<PublishSnapshot>(), [step, setStep] = useState(0), [checking, setChecking] = useState(false), [error, setError] = useState<string>();
  const [showHistoryReminder, setShowHistoryReminder] = useState(false);
  const [errors, setErrors] = useState<{ version?: string; message?: string }>({});
  const [failedPaths, setFailedPaths] = useState<readonly string[]>([]);
  const branches = useApiQuery([...queryKeys.branches(projectId), 'publish-source'], () => api.services.listBranches(serviceId), { enabled: source === 'repository' });
  const workspace = useApiQuery([...queryKeys.devSession(projectId), 'workspace-status'], async () => WorkspaceStatusDtoSchema.parse(await api.devSession.workspaceStatus(projectId)), { enabled: source === 'session' });
  const sessionMissing = source === 'session' && isMissingSession(workspace.error);
  const tags = useApiQuery(queryKeys.tags(serviceId), () => api.services.listTags(serviceId));
  const selected = branch || branches.data?.items.find((entry) => entry.isDefault)?.name || branches.data?.items[0]?.name || '';
  const publication = useApiMutation((input: PublishDevSessionInput) => source === 'session' ? api.devSession.publish(projectId, input) : api.services.publish(serviceId, input), { invalidate: [queryKeys.releases(serviceId), queryKeys.slots(serviceId), queryKeys.tags(serviceId), queryKeys.branches(projectId)] });
  const busy = checking || publication.isPending, current = snapshot?.source === source ? snapshot : undefined;
  const dirty = !complete && (branch !== '' || version !== 'patch' || message !== ''), { markDraft } = actions;
  useEffect(() => { markDraft('publish', !accepted.current && (dirty || busy)); return () => markDraft('publish', false); }, [dirty, busy, markDraft]);
  const stale = !!current && (!!(source === 'session' ? workspace.error : branches.error) || !publishSourceStillMatches(current, workspace.data, branches.data?.items ?? []));
  const resetCheck = () => { if (lock.current) return false; setSnapshot(undefined); setStep(0); setError(undefined); setShowHistoryReminder(false); setFailedPaths([]); return true; };
  const check = async () => {
    if (lock.current || !canPublish || !actions.begin('publish')) return; lock.current = true; setChecking(true); setError(undefined); setShowHistoryReminder(false); setFailedPaths([]); setSnapshot(undefined); setStep(0);
    try {
      const result = source === 'session' ? await workspace.refetch() : await branches.refetch();
      if (result.error || !result.data) throw result.error ?? new Error(t('release.prepare.unknown'));
      const checked = 'items' in result.data ? repositoryPublishSnapshot(result.data.items, selected || result.data.items.find((entry) => entry.isDefault)?.name || result.data.items[0]?.name || '', new Date().toISOString()) : sessionPublishSnapshot(result.data);
      if (!checked.snapshot) { setError(checked.problem?.startsWith('release.') ? t(checked.problem) : checked.problem); return; }
      setSnapshot(checked.snapshot); setStep(1);
    } catch (cause) { if (source !== 'session' || !isMissingSession(cause)) setError(errorMessage(cause)); } finally { lock.current = false; setChecking(false); actions.finish('publish'); }
  };
  const submit = async () => {
    if (lock.current || !canPublish || !current || step !== 2 || tags.error || tags.isPending || stale) return;
    const invalid = { ...(!isPublishVersion(version) ? { version: t('release.publish.versionInvalid') } : {}), ...(message.length > 500 ? { message: t('release.prepare.messageInvalid') } : {}) };
    if (Object.keys(invalid).length) { setErrors(invalid); return; }
    if (tags.data?.items.some((tag) => tag.name === version.trim())) { setErrors({ version: t('release.prepare.tagExists') }); return; }
    if (!actions.begin('publish')) return; lock.current = true; setError(undefined); setErrors({});
    try {
      const result = await publication.mutateAsync({ branch: current.branch, version: version.trim(), expectedCommitSha: current.commitSha, ...(current.taskId ? { expectedTaskId: current.taskId } : {}), ...(message.trim() ? { message: message.trim() } : {}) });
      const parsed = ReleaseDtoSchema.safeParse(result);
      if (!parsed.success || parsed.data.serviceId !== serviceId || parsed.data.commitSha !== current.commitSha) throw new Error(t('release.prepare.responseUnknown'));
      accepted.current = true; setComplete(true); markDraft('publish', false); actions.finish('publish'); if (mounted.current) onAccepted(parsed.data);
    } catch (cause) { setError(errorMessage(cause)); setShowHistoryReminder(!(isApiClientError(cause) && cause.status === 0 && cause.details.requestSent === false)); setFailedPaths(uncommittedPaths(cause) ?? []); setSnapshot(undefined); setStep(0); void tags.refetch(); if (source === 'repository') void branches.refetch(); }
    finally { lock.current = false; actions.finish('publish'); }
  };
  return { source, branches, workspace, tags, selected, branch, version, message, setVersion, setMessage, setBranch, step: current ? step : 0, setStep, snapshot: current, resetCheck, check, submit, busy, checking, error, errors, setErrors, failedPaths, canPublish, stale,
    dirty, accepted, sessionMissing, showHistoryReminder,
    candidate: tags.data && !tags.error ? candidateReleaseTag(tags.data.items.map((tag) => tag.name), version) : undefined };
}
export type PublishPreparation = ReturnType<typeof usePublishPreparation>;

function isMissingSession(error: unknown): boolean {
  return isApiClientError(error) && error.status === 404 && error.kind === 'not_found';
}
