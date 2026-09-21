import type { PreviewStatusResult } from '@crewstation/api-client';
import type { PreviewAction, PreviewStatusDto } from '@crewstation/contracts';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { PreviewCommands } from '../model/preview/previewStatusStore';
import { PreviewStatusStore } from '../model/preview/previewStatusStore';
import { api } from '../../../shared/api/client';
import { useT } from '../../../shared/lib/useT';
import type { TaskStreamChannel } from './useTaskStream';

export interface PreviewHandle {
  readonly status: PreviewStatusResult;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly confirmed: boolean;
  readonly refresh: () => void;
  readonly run: (action: PreviewAction) => void;
}

/** DTO 比 store 需要的多几项（taskId、previewHost、url）；主机名由会话给出，这里只留进程事实。 */
function toResult(dto: PreviewStatusDto): PreviewStatusResult {
  return {
    state: dto.state, restarts: dto.restarts,
    ...(dto.port === undefined ? {} : { port: dto.port }),
    ...(dto.lastError === undefined ? {} : { lastError: dto.lastError }),
  };
}

export function previewCommandsFor(projectId: string): PreviewCommands {
  return {
    status: async () => toResult(await api.devSession.previewStatus(projectId)),
    control: async (action) => toResult(await api.devSession.controlPreview(projectId, action)),
  };
}

/**
 * 预览进程：状态与控制走 cs-api（RFC-016），之后跟任务流的 previewState 事件走。
 * 停止后不会自动拉起——这是设计意图，不是故障。
 */
export function usePreviewStatus(channel: TaskStreamChannel, projectId: string, generation = 0, connected = true, commands?: PreviewCommands): PreviewHandle {
  const t = useT();
  const resolved = useMemo(() => commands ?? previewCommandsFor(projectId), [commands, projectId]);
  const store = useMemo(() => new PreviewStatusStore(channel, resolved, { generation, connected }), [channel, resolved, generation, connected]);
  useEffect(() => { store.activate(); return store.deactivate; }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const error = state.actionError
    ? t('devSession.preview.actionUnconfirmed', { action: t(`devSession.preview.${state.actionLabel ?? 'restart'}`), reason: state.actionError })
    : state.loadError;
  return { status: state.status, busy: state.busy, confirmed: state.confirmed, error, refresh: store.refresh, run: store.run };
}
