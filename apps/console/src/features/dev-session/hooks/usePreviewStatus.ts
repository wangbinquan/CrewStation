import type { PreviewStatusResult } from '@crewstation/api-client';
import { useCallback, useEffect, useState } from 'react';
import { UNKNOWN_PREVIEW, applyPreviewEvent } from '../model/previewSnapshot';
import { streamErrorMessage } from '../model/runnerErrors';
import { asPreviewStatusResult } from '../model/runnerResults';
import { useStreamEvent } from './useStreamEvent';
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
  const [status, setStatus] = useState<PreviewStatusResult>(UNKNOWN_PREVIEW);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirmed, setConfirmed] = useState(false);

  // 只发命令、不同步改状态：挂载时的首次查询走它，避免在 effect 里同步 setState。
  const load = useCallback(
    (): Promise<void> =>
      channel
        .send({ type: 'previewStatus' })
        .then(asPreviewStatusResult)
        .then((result) => {
          setStatus(result);
          setConfirmed(true);
          setError(undefined);
        })
        .catch((cause: unknown) => setError(streamErrorMessage(cause))),
    [channel],
  );

  useEffect(() => {
    if (connected) void load();
  }, [load, generation, connected]);

  useStreamEvent(
    channel,
    'previewState',
    useCallback((event) => setStatus((current) => applyPreviewEvent(current, event)), []),
  );

  const refresh = useCallback(() => {
    setBusy(true);
    void load().finally(() => setBusy(false));
  }, [load]);

  const restart = useCallback(() => {
    setBusy(true);
    channel
      .send({ type: 'restartPreview' })
      .then(() => setError(undefined))
      .catch((cause: unknown) => setError(streamErrorMessage(cause)))
      .finally(() => void load().finally(() => setBusy(false)));
  }, [channel, load]);

  return { status, busy, error, refresh, restart, confirmed };
}
