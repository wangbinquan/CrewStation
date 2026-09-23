import { useEffect, useRef } from 'react';
import { useProjectResources } from '../../../shared/resources/useProjectResources';

/**
 * 槽卡随资源推送流更新（RFC-025 第三期）：服务槽记录（状态、副本数、版本、保留计时）一有变化就在原位重读槽的 DTO，
 * 取代每 5 秒一次的轮询。第一次拿到记录时不重读（槽的 DTO 与它同时读过）。
 */
export function useSlotRecordRefresh(projectId: string, refetch: () => unknown): void {
  const records = useProjectResources(projectId);
  const signature = (records.data?.items ?? []).filter((record) => record.kind === 'service-slot').map((record) => `${record.id}:${record.version}`).sort().join(',');
  const seen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!records.isSuccess) return;
    if (seen.current !== undefined && seen.current !== signature) void refetch();
    seen.current = signature;
  }, [records.isSuccess, signature, refetch]);
}
