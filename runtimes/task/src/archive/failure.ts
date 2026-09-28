import type { ArchiveHelperFailure } from '@crewstation/contracts';

/** Only a fixed code and a manifest path cross the helper protocol; raw errors remain local. */
export class ArchiveFileError extends Error {
  constructor(readonly code: ArchiveHelperFailure['code'], message: string) { super(message); }
}
