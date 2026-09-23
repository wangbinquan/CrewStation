import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import type { NavigationLocation } from '../../../../shared/navigation/UnsavedChangesGuard';
import { parseDevelopmentSearch } from '../../../../shared/project/developmentSearch';
import type { DevelopmentSearch, DevelopmentView } from '../../../../shared/project/developmentSearch';
import { PROJECT_PATHS, projectPageFromPath } from '../../../../shared/project/projectPaths';
import type { ProjectSpace } from '../../../../shared/project/projectPaths';
import { useProjectScope } from '../../../../shared/project/ProjectScope';
import { locationView, toolSearch } from '../../model/layout/developmentLocation';
import type { WorkspaceToolName } from '@crewstation/contracts';
import type { FileEditorHandle } from '../useFileEditor';

/**
 * 本页自己的地址。TanStack Router 在跳转一开始就发布新地址，新页面提交前开发页仍挂着：离开途中的地址（如 /release，没有 view）
 * 会被当成「无参数进入」，把跳转 replace 回开发页——2026-09-23 实机左栏点什么都被拽回来。离开途中沿用本页最后一次的地址。
 */
function usePageLocation(projectId: string, space: ProjectSpace) {
  const location = useLocation(), own = projectPageFromPath(location.pathname, projectId, space) === 'development';
  const [last, setLast] = useState(location);
  if (own && last !== location) setLast(location);
  return { location: own ? location : last, leaving: !own };
}

/** 显式地址优先；只读指定文件，不触发写入、CLI 启停或取得终端控制。 */
export function useDevelopmentLocation(taskId: string, editor: FileEditorHandle, connected: boolean) {
  const { projectId, space } = useProjectScope(), { location, leaving } = usePageLocation(projectId, space);
  const search = parseDevelopmentSearch(location.search), navigate = useNavigate();
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
  // replace 是把本页状态写回地址（布局恢复、文件关闭），离开途中不写：否则同样会把跳转拽回开发页。
  const go = useCallback((value: DevelopmentSearch, replace = false) => { if (!replace || !leaving) void navigate({ to: PROJECT_PATHS[space].development, params: { projectId }, search: value, replace }); }, [navigate, projectId, space, leaving]);
  const previousFile = useRef(editor.file?.path);
  useEffect(() => {
    const closed = previousFile.current && !editor.file; previousFile.current = editor.file?.path;
    if (closed && search.file) go({ ...search, file: undefined }, true);
  }, [editor.file, search, go]);
  const selectView = (selected: DevelopmentView) => go({ view: selected, file: search.file, target: search.target });
  // 面板状态写进地址：只保留文件、比较目标与参考面板的定位参数，不带活动定位的一次性参数。
  const selectTool = (tool: { name: WorkspaceToolName; mode: 'side' | 'full' } | null, replace = false) => go(toolSearch(tool, { file: search.file, target: search.target, topic: search.topic, guide: search.guide, proxy: search.proxy, operation: search.operation, subscription: search.subscription }), replace);
  const fileChange = (next: NavigationLocation) => {
    const value = parseDevelopmentSearch(next.search as Record<string, unknown>);
    return next.pathname === location.pathname && locationView(value) === 'code' && (!value.task || value.task === taskId) && value.file !== editor.file?.path ? value.file : undefined;
  };
  return { key, search, selectView, selectTool, wrongTask, fileChange,
    openFile: (next: string) => go({ view: 'code', file: next, target: search.target, ...(search.panel ? { panel: search.panel } : {}) }),
    selectTarget: (target: 'prod' | 'preview') => go({ view: 'changes', file: search.file, target, ...(search.panel ? { panel: search.panel } : {}) }),
    approveFile: (next: NavigationLocation) => { const nextFile = fileChange(next); if (nextFile) {
      approved.current = { file: nextFile, draft: editor.draft, source: editor.file?.path, revision: editor.file?.revision }; editor.cancelDiscard();
    } },
  };
}
