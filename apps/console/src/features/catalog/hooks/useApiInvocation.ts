import type { ApiInvocationRequest, ApiInvocationResponse, ApiOperationDto } from '@crewstation/contracts';
import { ApiInvocationResponseSchema, DevSessionDtoSchema } from '@crewstation/contracts';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';

export interface ApiInvocationOutcome { request: ApiInvocationRequest; response: ApiInvocationResponse }
export interface ApiInvocationContext { projectId: string; canDevelop: boolean; operations: readonly ApiOperationDto[]; catalogReady: boolean }

/** 详情和 Swagger 共用写入锁、固定会话及结果校验；用户输入只保留在本页内存中。 */
export function useApiInvocation(context: ApiInvocationContext) {
  const t = useT();
  const session = useApiQuery(queryKeys.devSession(context.projectId), () => api.devSession.get(context.projectId), { enabled: context.canDevelop });
  const [taskId, setTaskId] = useState<string>(), [error, setError] = useState<string>();
  const [pending, setPending] = useState(false), [checking, setChecking] = useState(false), [dirtySources, setDirtySources] = useState<string[]>([]), [outcome, setOutcome] = useState<ApiInvocationOutcome>();
  const locked = useRef(false), binding = useRef<string>(undefined), revisions = useRef(new Map<string, number>()), life = useRef(0);
  useEffect(() => { const generation = life.current + 1; life.current = generation; return () => { life.current = generation + 1; }; }, []);
  const parsedSession = DevSessionDtoSchema.safeParse(session.data);
  const currentTaskId = !session.error && parsedSession.success && parsedSession.data.projectId === context.projectId && parsedSession.data.state === 'running' ? parsedSession.data.taskId : undefined;
  const begin = (): string | undefined => {
    if (locked.current) { setError(t('catalog.invoke.busy')); return; }
    if (!context.canDevelop || !context.catalogReady || !currentTaskId) { setError(t('catalog.invoke.noSession')); return; }
    if (binding.current && binding.current !== currentTaskId) { setError(t('catalog.invoke.sessionChanged')); return; }
    binding.current = currentTaskId; setTaskId(currentTaskId); setError(undefined);
    return currentTaskId;
  };
  const rebind = async (): Promise<void> => {
    if (locked.current || !context.canDevelop) return;
    locked.current = true; setChecking(true);
    const generation = life.current;
    try {
      const fresh = await session.refetch();
      if (generation !== life.current) return;
      const parsed = DevSessionDtoSchema.safeParse(fresh.data);
      if (fresh.error || !parsed.success || parsed.data.projectId !== context.projectId || parsed.data.state !== 'running') { setError(t('catalog.invoke.noSession')); return; }
      binding.current = parsed.data.taskId; setTaskId(parsed.data.taskId); setError(undefined);
    } finally { locked.current = false; if (generation === life.current) setChecking(false); }
  };
  const send = async (source: string, input: ApiInvocationRequest): Promise<ApiInvocationResponse> => {
    if (locked.current) throw new Error(t('catalog.invoke.busy'));
    if (!context.canDevelop || !context.catalogReady || !context.operations.some((item) => item.key === input.operationKey && item.granted === true)) throw new Error(t('catalog.invoke.operationUnavailable'));
    if (!binding.current || input.expectedTaskId !== binding.current || currentTaskId !== binding.current) throw new Error(t('catalog.invoke.sessionChanged'));
    locked.current = true; setPending(true); setError(undefined); setOutcome(undefined);
    const generation = life.current, submittedRevision = revisions.current.get(source);
    try {
      const parsed = ApiInvocationResponseSchema.safeParse(await api.devSession.invokeApi(context.projectId, input));
      if (!parsed.success || parsed.data.taskId !== input.expectedTaskId || parsed.data.operationKey !== input.operationKey) throw new Error(t('catalog.invoke.unknownResult'));
      if (generation === life.current) { setError(undefined); setOutcome({ request: input, response: parsed.data }); if (submittedRevision === revisions.current.get(source)) setDirtySources((sources) => sources.filter((item) => item !== source)); }
      return parsed.data;
    } catch (failure) { if (generation === life.current) setError(errorMessage(failure)); throw failure; }
    finally { locked.current = false; if (generation === life.current) setPending(false); }
  };
  const markDirty = (source: string) => { revisions.current.set(source, (revisions.current.get(source) ?? 0) + 1); setDirtySources((sources) => sources.includes(source) ? sources : [...sources, source]); };
  const clearDirty = (source: string) => { revisions.current.set(source, (revisions.current.get(source) ?? 0) + 1); setDirtySources((sources) => sources.filter((item) => item !== source)); };
  return { taskId, currentTaskId, pending, checking, dirty: dirtySources.length > 0, dirtySources, outcome, error, session, begin, rebind, send, markDirty, clearDirty, reportError: (failure: unknown) => setError(t(errorMessage(failure))) };
}

export type ApiInvocationController = ReturnType<typeof useApiInvocation>;
