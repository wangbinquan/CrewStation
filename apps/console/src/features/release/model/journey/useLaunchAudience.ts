import { useRef, useState } from 'react';
import { AppVisibilityDtoSchema } from '@crewstation/contracts';
import type { AppVisibilityDto, AppVisibilityMode } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { useApiQuery, errorMessage } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';

/** 范围保存与流量切换是两个真实动作；先核对版本，再保存范围，最后请求上线。 */
export function useLaunchAudience(projectId: string, userId: string, enabled: boolean) {
  const t = useT(), lock = useRef(false), [draft, setDraft] = useState<AppVisibilityDto>(), [busy, setBusy] = useState(false), [error, setError] = useState<string>(), [saved, setSaved] = useState(false);
  const query = useApiQuery(['app-visibility', userId, projectId], async () => AppVisibilityDtoSchema.parse(await api.projects.getAppVisibility(projectId)), { enabled, refetchIntervalMs: 30_000 });
  const current = draft ?? query.data, conflict = !!draft && !!query.data && draft.revision !== query.data.revision;
  const dirty = !!draft && !!query.data && (draft.mode !== query.data.mode || draft.allowRequests !== query.data.allowRequests);
  const select = (mode: AppVisibilityMode) => { if (current && !lock.current) { setDraft({ ...current, mode }); setSaved(false); } };
  const launch = async (next: () => Promise<void>) => {
    if (lock.current || enabled && (!current || query.error || conflict)) return;
    lock.current = true; setBusy(true); setError(undefined);
    try {
      if (enabled && current) {
        const actual = AppVisibilityDtoSchema.parse(await api.projects.getAppVisibility(projectId));
        if (actual.revision !== current.revision) throw new Error(t('release.audience.changed'));
        if (current.mode !== actual.mode || current.allowRequests !== actual.allowRequests) {
          if (!actual.canConfigure) throw new Error(t('release.audience.noPermission'));
          const receipt = AppVisibilityDtoSchema.parse(await api.projects.setAppVisibility(projectId, { mode: current.mode, allowRequests: current.allowRequests, expectedRevision: actual.revision }));
          if (receipt.mode !== current.mode || receipt.allowRequests !== current.allowRequests || receipt.revision <= actual.revision) throw new Error(t('release.audience.unknown'));
          setDraft(undefined); setSaved(true);
        }
      }
      await next();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { if (enabled) await query.refetch(); lock.current = false; setBusy(false); }
  };
  return { enabled, query, current, conflict, busy, error, saved, dirty, select, launch,
    blocked: enabled && (!current || !!query.error || conflict), recheck: () => { setDraft(undefined); setError(undefined); void query.refetch(); } };
}
export type LaunchAudience = ReturnType<typeof useLaunchAudience>;
