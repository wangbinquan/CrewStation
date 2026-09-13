import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import type { NavigationLocation } from '../../../../shared/navigation/UnsavedChangesGuard';
import { parseDevelopmentSearch } from '../../../../shared/project/developmentSearch';
import type { DevelopmentSearch, DevelopmentView } from '../../../../shared/project/developmentSearch';
import { PROJECT_PATHS } from '../../../../shared/project/projectPaths';
import { useProjectScope } from '../../../../shared/project/ProjectScope';
import { locationView } from '../../model/layout/developmentLocation';
import type { FileEditorHandle } from '../useFileEditor';

/** 显式地址优先；只读指定文件，不触发写入、CLI 启停或取得终端控制。 */
export function useDevelopmentLocation(taskId: string, editor: FileEditorHandle, connected: boolean) {
  const location = useLocation(), search = parseDevelopmentSearch(location.search), navigate = useNavigate(), { projectId, space } = useProjectScope();
  const key = `${location.href}:${location.state.__TSR_key}`, handled = useRef<string | undefined>(undefined);
  const approved = useRef<{ file: string; draft: string; source: string | undefined; revision: number | undefined } | undefined>(undefined);
  const file = search.file, view = locationView(search), wrongTask = !!search.task && search.task !== taskId;
  const { openFile, discardAndOpen, busy, pendingAction } = editor;
  useEffect(() => {
    if (!file || view !== 'code' || wrongTask || !connected || busy || pendingAction || handled.current === key) return;
    handled.current = key;
    const permission = approved.current; approved.current = undefined;
    if (permission?.file === file && permission.draft === editor.draft && permission.source === editor.file?.path && permission.revision === editor.file?.revision) discardAndOpen(file);
    else openFile(file);
  }, [file, view, wrongTask, connected, busy, pendingAction, key, openFile, discardAndOpen, editor.draft, editor.file]);
  const go = useCallback((value: DevelopmentSearch, replace = false) => void navigate({ to: PROJECT_PATHS[space].development, params: { projectId }, search: value, replace }), [navigate, projectId, space]);
  const previousFile = useRef(editor.file?.path);
  useEffect(() => {
    const closed = previousFile.current && !editor.file; previousFile.current = editor.file?.path;
    if (closed && search.file) go({ ...search, file: undefined }, true);
  }, [editor.file, search, go]);
  const selectView = (selected: DevelopmentView) => go({ view: selected, file: search.file, target: search.target });
  const fileChange = (next: NavigationLocation) => {
    const value = parseDevelopmentSearch(next.search as Record<string, unknown>);
    return next.pathname === location.pathname && locationView(value) === 'code' && (!value.task || value.task === taskId) && value.file !== editor.file?.path ? value.file : undefined;
  };
  return { key, search, selectView, wrongTask, fileChange,
    openFile: (next: string) => go({ view: 'code', file: next, target: search.target }),
    selectTarget: (target: 'prod' | 'preview') => go({ view: 'diff', file: search.file, target }),
    approveFile: (next: NavigationLocation) => { const nextFile = fileChange(next); if (nextFile) {
      approved.current = { file: nextFile, draft: editor.draft, source: editor.file?.path, revision: editor.file?.revision }; editor.cancelDiscard();
    } },
  };
}
