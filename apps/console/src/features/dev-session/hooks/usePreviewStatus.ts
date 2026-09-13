import type { PreviewStatusResult } from '@crewstation/api-client';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { PreviewStatusStore } from '../model/preview/previewStatusStore';
import { useT } from '../../../shared/lib/useT';
import type { TaskStreamChannel } from './useTaskStream';

export interface PreviewHandle {
  readonly status: PreviewStatusResult;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly confirmed: boolean;
  readonly refresh: () => void;
  readonly restart: () => void;
}

/** 预览进程：状态先查一次，之后跟 previewState 事件走；协议只提供重启，没有单独的启停命令。 */
export function usePreviewStatus(channel: TaskStreamChannel, generation = 0, connected = true): PreviewHandle {
  const t = useT(), store = useMemo(() => new PreviewStatusStore(channel, { generation, connected }), [channel, generation, connected]);
  useEffect(() => { store.activate(); return store.deactivate; }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const error = state.restartError ? t('devSession.preview.restartUnconfirmed', { reason: state.restartError }) : state.loadError;
  return { status: state.status, busy: state.busy, confirmed: state.confirmed, error, refresh: store.refresh, restart: store.restart };
}
