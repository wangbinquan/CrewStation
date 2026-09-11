import { useCallback, useRef, useState } from 'react';
import { isVersionConflict, streamErrorMessage } from '../model/runnerErrors';
import { asReadFileResult, asWriteFileResult } from '../model/runnerResults';
import type { TaskStreamChannel } from './useTaskStream';

export interface EditorFile {
  readonly path: string;
  /** readFile 返回的内容 sha256，写回时作 expectedVersion。 */
  readonly version: string;
  /** 每次从磁盘读入自增；编辑器据此重置文档，保存成功不重置。 */
  readonly revision: number;
}

export interface FileEditorHandle {
  readonly file: EditorFile | undefined;
  readonly draft: string;
  readonly dirty: boolean;
  readonly busy: boolean;
  /** 磁盘上的版本与打开时不同：提示重新载入，绝不覆盖。 */
  readonly conflict: boolean;
  readonly error: string | undefined;
  readonly openFile: (path: string) => void;
  readonly change: (next: string) => void;
  readonly save: () => void;
  readonly reload: () => void;
  /** 先不重载、继续编辑：只收起冲突提示，保存仍会被 expectedVersion 挡住。 */
  readonly dismissConflict: () => void;
  readonly close: () => void;
}

/** 单文件编辑：读入、改、按 expectedVersion 写回；冲突只提示不覆盖。 */
export function useFileEditor(channel: TaskStreamChannel): FileEditorHandle {
  const [file, setFile] = useState<EditorFile | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [baseline, setBaseline] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const revisionRef = useRef(0);
  // 连续点两个文件时，后发的请求才算数，先回来的旧结果要丢掉。
  const requestRef = useRef(0);

  const read = useCallback(
    (path: string) => {
      const ticket = requestRef.current + 1;
      requestRef.current = ticket;
      setBusy(true);
      channel
        .send({ type: 'readFile', path })
        .then(asReadFileResult)
        .then((result) => {
          if (requestRef.current !== ticket) return;
          revisionRef.current += 1;
          setFile({ path: result.path || path, version: result.version, revision: revisionRef.current });
          setDraft(result.content);
          setBaseline(result.content);
          setConflict(false);
          setError(undefined);
        })
        .catch((cause: unknown) => {
          if (requestRef.current === ticket) setError(streamErrorMessage(cause));
        })
        .finally(() => {
          if (requestRef.current === ticket) setBusy(false);
        });
    },
    [channel],
  );

  const save = useCallback(() => {
    if (file === undefined) return;
    setBusy(true);
    channel
      .send({ type: 'writeFile', path: file.path, content: draft, expectedVersion: file.version })
      .then(asWriteFileResult)
      .then((result) => {
        setFile((current) => (current === undefined ? current : { ...current, version: result.version }));
        setBaseline(draft);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (isVersionConflict(cause)) setConflict(true);
        else setError(streamErrorMessage(cause));
      })
      .finally(() => setBusy(false));
  }, [channel, draft, file]);

  const close = useCallback(() => {
    requestRef.current += 1;
    setFile(undefined);
    setDraft('');
    setBaseline('');
    setConflict(false);
    setError(undefined);
  }, []);

  return {
    file,
    draft,
    dirty: draft !== baseline,
    busy,
    conflict,
    error,
    openFile: read,
    change: setDraft,
    save,
    reload: useCallback(() => {
      if (file !== undefined) read(file.path);
    }, [file, read]),
    dismissConflict: useCallback(() => setConflict(false), []),
    close,
  };
}
