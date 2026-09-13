import type { DevelopmentSearch, DevelopmentView } from '../../../../shared/project/developmentSearch';

export interface WorkspaceLocation {
  readonly key: string; readonly search: DevelopmentSearch;
  readonly selectView: (view: DevelopmentView) => void;
}
export function locationView(search: DevelopmentSearch) {
  return search.view === 'changes' ? 'diff' : search.view ?? (search.file ? 'code' : search.agent || search.terminal ? 'cli' : search.target ? 'diff' : undefined);
}
