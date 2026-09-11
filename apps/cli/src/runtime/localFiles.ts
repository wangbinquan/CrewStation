import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { FileAccess } from './commandContext';

/** 真实文件系统的 FileAccess：读不到一律当作“不存在”，由调用方决定那是不是错误。 */
export function createLocalFiles(): FileAccess {
  return {
    readText: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return undefined;
      }
    },
    exists: (path) => existsSync(path),
    listDir: (path) => {
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },
  };
}
