import type { RunnerHello, TaskId } from '@crewstation/contracts';
import type { DevelopmentUsageJournal } from '../developmentUsageJournal';

/** Advertise v2 only from the actual selected Pod layout and currently readable original journal. */
export function developmentNativePageCapabilities(selected: { taskId: TaskId; podUid: string } | undefined,
  journal?: Pick<DevelopmentUsageJournal, 'info' | 'nativePage'>): Partial<RunnerHello['capabilities']> {
  if (!selected || !journal || typeof journal.nativePage !== 'function') return {};
  try {
    const info = journal.info();
    if (info.runtimeTaskId !== selected.taskId || info.podUid !== selected.podUid || info.receipt?.interruption != null) return {};
    return { developmentNativePagesV2: 2 };
  } catch { return {}; }
}
