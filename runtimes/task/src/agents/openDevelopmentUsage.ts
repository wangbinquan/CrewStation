import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
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
    for (const mount of [options.directory, options.bindingDirectory]) {
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
