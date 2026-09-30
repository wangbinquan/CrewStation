import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

export type ProjectCreationScope = 'digital-worker' | 'integration';
interface DialogSlot { scope: ProjectCreationScope; open: boolean; returnFocusTo: RefObject<HTMLElement | null>; onClose(): void }
const CreationContext = createContext<((scope: ProjectCreationScope, trigger?: HTMLElement | null) => void) | undefined>(undefined);

/** app 层注入项目表单；admin feature 只发出打开意图，不依赖另一 feature 的内部代码。 */
export function ProjectCreationProvider({ children, renderDialog }: { children: ReactNode; renderDialog(slot: DialogSlot): ReactNode }) {
  const [scope, setScope] = useState<ProjectCreationScope>('digital-worker'), [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement>(null);
  const openCreation = useCallback((next: ProjectCreationScope, trigger?: HTMLElement | null) => {
    opener.current = trigger ?? null; setScope(next); setOpen(true);
  }, []);
  return <CreationContext.Provider value={openCreation}>
    {children}{renderDialog({ scope, open, returnFocusTo: opener, onClose: () => setOpen(false) })}
  </CreationContext.Provider>;
}

export function useOpenProjectCreation() {
  const open = useContext(CreationContext);
  if (!open) throw new Error('ProjectCreationProvider is required');
  return open;
}
