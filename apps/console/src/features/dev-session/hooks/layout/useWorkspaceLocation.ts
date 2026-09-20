import { useEffect, useRef } from 'react';
import type { NativeTerminalDto } from '@crewstation/contracts';
import type { WorkspaceLayoutStore } from '../../model/layout/workspaceLayoutStore';
import type { WorkspaceLocation } from '../../model/layout/developmentLocation';
import { locationView } from '../../model/layout/developmentLocation';
import { revealActivityTerminal } from '../../model/layout/workspaceLayout';

export function useWorkspaceLocation(taskId: string, location: WorkspaceLocation | undefined, roster: NativeTerminalDto[] | undefined, store: WorkspaceLayoutStore, loaded: boolean, hasActivityTarget: boolean, tabName: string) {
  const handled = useRef<string | undefined>(undefined), search = location?.search, view = search && locationView(search);
  const wantsTerminal = view === 'cli' || view === 'split', terminal = roster?.find((r) => (!search?.agent || r.agentId === search.agent) && (!search?.terminal || r.terminalId === search.terminal));
  const selected = !!search?.agent || !!search?.terminal, wrongTask = !!search?.task && search.task !== taskId;
  const invalid = wrongTask || wantsTerminal && selected && roster !== undefined && !terminal;
  useEffect(() => {
    if (!location || !loaded || hasActivityTarget || invalid || !view || ['conversation', 'data', 'session'].includes(view) || selected && wantsTerminal && !roster || handled.current === location.key) return;
    handled.current = location.key;
    store.update((current) => {
      const next = wantsTerminal && selected && terminal ? revealActivityTerminal(current, terminal.terminalId, tabName) : current;
      const display = view === 'split' ? 'cli' : view === 'diff' ? 'changes' : view as 'cli' | 'preview' | 'code' | 'changes';
      const previewAlongside = wantsTerminal ? view === 'split' : next.previewAlongside;
      return next.view === display && next.previewAlongside === previewAlongside ? next : { ...next, view: display, previewAlongside };
    });
  }, [location, loaded, hasActivityTarget, invalid, view, selected, wantsTerminal, roster, terminal, store, tabName]);
  return invalid && !hasActivityTarget ? 'devSession.location.invalid' : undefined;
}
