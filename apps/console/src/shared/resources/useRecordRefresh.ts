import { useEffect, useRef } from 'react';
import type { ResourceKind } from '@crewstation/contracts';
import { useProjectResources } from './useProjectResources';

/**
 * 按资源记录重读（RFC-025）：项目里这几种记录（状态、副本数、版本、保留计时……）一有变化就在原位重读一次页面自己的数据，
 * 取代定时轮询。第一次拿到记录时不重读（页面的数据与它同时读过）；别的种类的记录变化不重读。
 */
export function useRecordRefresh(projectId: string, kinds: readonly ResourceKind[], refetch: () => unknown, options: { readonly enabled?: boolean } = {}): void {
  const records = useProjectResources(projectId, { enabled: options.enabled ?? true });
  const signature = (records.data?.items ?? []).filter((record) => kinds.includes(record.kind)).map((record) => `${record.id}:${record.version}`).sort().join(',');
  const seen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!records.isSuccess) return;
    if (seen.current !== undefined && seen.current !== signature) void refetch();
    seen.current = signature;
  }, [records.isSuccess, signature, refetch]);
}
