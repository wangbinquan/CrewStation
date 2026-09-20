import type { OidcProbeResult, OidcProviderDto } from '@crewstation/contracts';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { useApiMutation } from '../../../shared/api/useApi';
import type { ApiClientError } from '../../../shared/api/useApi';

export interface ProviderProbe {
  readonly version: string;
  readonly pending: boolean;
  readonly result?: OidcProbeResult;
  readonly error?: ApiClientError;
  readonly completedAt?: string;
}
export const providerVersion = (provider: OidcProviderDto) => JSON.stringify(provider);

/** 每个提供方独立请求代次；迟到结果不会覆盖新请求，配置版本变化后只能作为过期结果展示。 */
export function useProviderProbe() {
  const [probes, setProbes] = useState<Record<string, ProviderProbe>>({});
  const sequence = useRef<Record<string, number>>({}), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const test = useApiMutation((id: string) => api.auth.testProvider(id));
  const run = async (provider: OidcProviderDto) => {
    const id = provider.id, version = providerVersion(provider), request = (sequence.current[id] ?? 0) + 1;
    sequence.current[id] = request;
    setProbes((current) => ({ ...current, [id]: { version, pending: true } }));
    const publish = (value: ProviderProbe) => {
      if (mounted.current && sequence.current[id] === request) setProbes((current) => ({ ...current, [id]: value }));
    };
    try { const result = await test.mutateAsync(id); publish({ version, result, pending: false, completedAt: new Date().toISOString() }); }
    catch (error) { publish({ version, error: error as ApiClientError, pending: false }); }
  };
  const invalidate = (id: string) => {
    sequence.current[id] = (sequence.current[id] ?? 0) + 1;
    setProbes((current) => current[id] ? { ...current, [id]: { ...current[id], version: '', pending: false } } : current);
  };
  return { probes, run, invalidate };
}
