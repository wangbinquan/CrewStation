import { randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '@crewstation/kernel';
import type { RunnerConfig } from '../config';
import { DevelopmentUsageJournal } from './developmentUsageJournal';
import { publishDevelopmentStoreBinding, readDevelopmentStoreBinding } from './developmentUsageStoreBinding';

function privateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new Error('unsafe private directory');
}
function recordedFile(directory: string, name: string, expected?: string): void {
  const file = join(directory, name), stat = lstatSync(file);
  if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0 || (expected !== undefined && (stat.size !== Buffer.byteLength(expected) || readFileSync(file, 'utf8') !== expected))) throw new Error('lost numeric journal');
}

/** Independent private emptyDirs survive container restart; neither is a worker HOME or a business PVC. */
export function openDevelopmentUsage(config: RunnerConfig, logger: Logger): DevelopmentUsageJournal | undefined {
  const options = config.developmentUsage;
  if (!options) return undefined;
  let journal: DevelopmentUsageJournal | undefined;
  try {
    if (options.directory === options.bindingDirectory) throw new Error('binding must be independent');
    const mounts = [options.directory, options.bindingDirectory];
    const initial = mounts.map((mount) => lstatSync(mount));
    if (initial.some((stat) => !stat.isDirectory() || stat.uid !== process.getuid?.())) throw new Error('unsafe mount');
    if (initial.some((stat) => (stat.mode & 0o022) !== 0)) {
      // Kubernetes creates new emptyDir roots as 0777. Initialize only that exact
      // fresh layout before opening the original journal or launching any Agent.
      // Inspect BOTH mounts first: surviving original data must never be renamed
      // into a fresh store, and every existing-store rejection remains intact.
      if (initial.some((stat) => (stat.mode & 0o022) !== 0 && (stat.mode & 0o7777) !== 0o777)
        || mounts.some((mount) => readdirSync(mount).length !== 0)) throw new Error('unsafe mount');
      for (let i = 0; i < mounts.length; i++) if ((initial[i]!.mode & 0o022) !== 0) chmodSync(mounts[i]!, 0o700);
    }
    for (const mount of mounts) {
      const stat = lstatSync(mount);
      if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0) throw new Error('unsafe mount');
    }
    const context = { projectId: options.projectId, workspaceTaskId: options.workspaceTaskId, runtimeTaskId: config.taskId, podUid: options.podUid };
    const bindingDirectory = join(options.bindingDirectory, 'binding');
    privateDirectory(bindingDirectory);
    const expected = readDevelopmentStoreBinding(bindingDirectory, context);
    const directory = join(options.directory, 'journal');
    // Read the independent binding before opening SQLite. Missing numeric data cannot be recreated.
    if (expected) {
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new Error('lost private journal');
      recordedFile(directory, 'executions.sqlite');
      recordedFile(directory, 'journal.identity', expected);
      recordedFile(directory, 'development.pod', context.podUid);
    } else {
      privateDirectory(directory);
      if (readdirSync(directory).length !== 0) throw new Error('existing journal lost independent binding');
    }
    journal = new DevelopmentUsageJournal(directory, context, randomUUID());
    if (expected && journal.journalId !== expected) throw new Error('changed numeric journal');
    publishDevelopmentStoreBinding(bindingDirectory, context, journal.journalId);
    return journal;
  } catch { journal?.close(); logger.warn('development numeric journal unavailable'); return undefined; }
}
