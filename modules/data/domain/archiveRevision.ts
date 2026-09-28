import type { ArchivePlanEntry } from '@crewstation/contracts';

/** Making a required path optional is a discard too; aliases alone do not change the preserved path. */
export function discardedRequiredFiles(oldEntries: readonly ArchivePlanEntry[], newEntries: readonly ArchivePlanEntry[]) {
  const retained = new Set(newEntries.flatMap((entry) => entry.kind === 'file' && entry.required ? [entry.path] : []));
  return oldEntries.filter((entry): entry is Extract<ArchivePlanEntry, { kind: 'file' }> => entry.kind === 'file' && entry.required && !retained.has(entry.path));
}
