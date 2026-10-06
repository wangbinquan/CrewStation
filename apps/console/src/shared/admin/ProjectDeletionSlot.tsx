import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

export interface DeletionProject { readonly id: string; readonly name: string; readonly slug: string }
interface DialogSlot { project: DeletionProject; returnFocusTo: RefObject<HTMLElement | null>; onClose(): void }
interface Selection extends Omit<DialogSlot, 'onClose'> { restoreScroll(): void }
const DeletionContext = createContext<((project: DeletionProject, trigger: HTMLElement) => void) | undefined>(undefined);

/** App composes the public workflow; features only request a shared dialog. */
export function ProjectDeletionSlot({ children, available, renderDialog }: {
  readonly children: ReactNode; readonly available: boolean; readonly renderDialog: (slot: DialogSlot) => ReactNode;
}) {
  const [selected, setSelected] = useState<Selection>();
  const open = useCallback((value: DeletionProject, trigger: HTMLElement) => {
    const viewport = trigger.closest('main'), top = viewport?.scrollTop, left = viewport?.scrollLeft;
    // Background capability refreshes can replace the row action while the dialog remains selected.
    const returnFocusTo = { get current() { return trigger.isConnected ? trigger : trigger.id ? document.getElementById(trigger.id) : null; } };
    const restoreScroll = () => {
      if (viewport?.isConnected && returnFocusTo.current && viewport.contains(returnFocusTo.current)) {
        viewport.scrollTop = top!; viewport.scrollLeft = left!;
      }
    };
    setSelected({ project: { id: value.id, name: value.name, slug: value.slug }, returnFocusTo, restoreScroll });
  }, []);
  return <DeletionContext.Provider value={available ? open : undefined}>
    {children}{available && selected ? renderDialog({ ...selected, onClose: () => {
      selected.restoreScroll(); setSelected(undefined);
      setTimeout(selected.restoreScroll, 0);
    } }) : null}
  </DeletionContext.Provider>;
}

export function useOpenProjectDeletion() { return useContext(DeletionContext); }
