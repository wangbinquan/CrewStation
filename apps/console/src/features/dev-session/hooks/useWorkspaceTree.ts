import type { FileEntry } from '@crewstation/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { streamErrorMessage } from '../model/runnerErrors';
import { asListFilesResult } from '../model/runnerResults';
import { WORKSPACE_ROOT, parentPath, sortEntries } from '../model/workspacePath';
import { useStreamEvent } from './useStreamEvent';
import type { TaskStreamChannel } from './useTaskStream';

/** Agent 连续改文件时 fileChanged 很密，攒一下再重列，避免一次编辑打十几个 listFiles。 */
const RELIST_INTERVAL_MS = 1_500;

export interface WorkspaceTree {
  readonly entriesByDir: Readonly<Record<string, readonly FileEntry[]>>;
  readonly expanded: ReadonlySet<string>;
  readonly error: string | undefined;
  readonly toggle: (dir: string) => void;
  readonly reload: (dir: string) => void;
}

/** 文件树：按需列目录，容器里文件变化时只重列已经展开过的目录。 */
export function useWorkspaceTree(channel: TaskStreamChannel, generation = 0, connected = true): WorkspaceTree {
  const [entriesByDir, setEntriesByDir] = useState<Readonly<Record<string, readonly FileEntry[]>>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([WORKSPACE_ROOT]));
  const [error, setError] = useState<string | undefined>(undefined);
  const staleRef = useRef<Set<string>>(new Set());
  const loadedRef = useRef<Set<string>>(new Set());

  const reload = useCallback(
    (dir: string) => {
      loadedRef.current.add(dir);
      channel
        .send({ type: 'listFiles', path: dir })
        .then(asListFilesResult)
        .then((result) => {
          setEntriesByDir((current) => ({ ...current, [dir]: sortEntries(result.entries) }));
          setError(undefined);
        })
        .catch((cause: unknown) => setError(streamErrorMessage(cause)));
    },
    [channel],
  );

  useEffect(() => {
    if (connected) for (const dir of new Set([WORKSPACE_ROOT, ...loadedRef.current])) reload(dir);
  }, [reload, generation, connected]);

  const toggle = useCallback(
    (dir: string) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.delete(dir)) return next;
        next.add(dir);
        return next;
      });
      if (!loadedRef.current.has(dir)) reload(dir);
    },
    [reload],
  );

  useStreamEvent(
    channel,
    'fileChanged',
    useCallback((event) => {
      const dir = parentPath(event.path);
      if (loadedRef.current.has(dir)) staleRef.current.add(dir);
    }, []),
  );

  useEffect(() => {
    const timer = setInterval(() => {
      const dirs = [...staleRef.current];
      staleRef.current.clear();
      for (const dir of dirs) reload(dir);
    }, RELIST_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [reload]);

  return { entriesByDir, expanded, error, toggle, reload };
}
