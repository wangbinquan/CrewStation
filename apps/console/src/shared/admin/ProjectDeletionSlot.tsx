import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

export interface DeletionProject { readonly id: string; readonly name: string; readonly slug: string }
interface DialogSlot { project: DeletionProject; returnFocusTo: RefObject<HTMLElement | null>; onClose(): void }
const DeletionContext = createContext<((project: DeletionProject, trigger: HTMLElement) => void) | undefined>(undefined);

/** App composes the public workflow; features only request a shared dialog. */
export function ProjectDeletionSlot({ children, available, renderDialog }: {
  readonly children: ReactNode; readonly available: boolean; readonly renderDialog: (slot: DialogSlot) => ReactNode;
}) {
  const [selected, setSelected] = useState<Omit<DialogSlot, 'onClose'>>();
  const open = useCallback((value: DeletionProject, trigger: HTMLElement) => {
    setSelected({ project: { id: value.id, name: value.name, slug: value.slug }, returnFocusTo: { current: trigger } });
  }, []);
  return <DeletionContext.Provider value={available ? open : undefined}>
    {children}{available && selected ? renderDialog({ ...selected, onClose: () => setSelected(undefined) }) : null}
  </DeletionContext.Provider>;
}

export function useOpenProjectDeletion() { return useContext(DeletionContext); }
