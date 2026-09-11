import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScratchDirs } from '../../ports/scratchDirs';

export function osScratchDirs(root: string = tmpdir()): ScratchDirs {
  return {
    create: async (prefix) => {
      const path = await mkdtemp(join(root, `${prefix}-`));
      return { path, remove: () => rm(path, { recursive: true, force: true }) };
    },
  };
}
