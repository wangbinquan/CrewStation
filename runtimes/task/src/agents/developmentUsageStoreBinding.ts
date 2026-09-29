import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DevelopmentUsageStoreBindingSchema } from '@crewstation/contracts';
import { RunnerCommandError, fsErrorCode } from '../commandError';
import type { DevelopmentJournalContext } from './developmentUsageJournal';

const markerName = 'store.binding';
function lost(): never { throw new RunnerCommandError('development_journal_lost', '开发日志的独立持久绑定已丢失或变化'); }

/** This marker lives on a different emptyDir from the numeric database and its local markers. */
export function readDevelopmentStoreBinding(directory: string, context: DevelopmentJournalContext): string | undefined {
  const marker = join(directory, markerName);
  try {
    const stat = lstatSync(marker);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > 4096) lost();
    const binding = DevelopmentUsageStoreBindingSchema.parse(JSON.parse(readFileSync(marker, 'utf8')));
    if (binding.runtimeTaskId !== context.runtimeTaskId || binding.workspaceTaskId !== context.workspaceTaskId || binding.projectId !== context.projectId || binding.podUid !== context.podUid) lost();
    return binding.journalId;
  } catch (error) { if (fsErrorCode(error) === 'ENOENT') return undefined; throw error; }
}

export function publishDevelopmentStoreBinding(directory: string, context: DevelopmentJournalContext, journalId: string): void {
  const body = JSON.stringify(DevelopmentUsageStoreBindingSchema.parse({ ...context, version: 1, journalId }));
  let fd: number;
  try { fd = openSync(join(directory, markerName), 'wx', 0o600); }
  catch (error) { if (fsErrorCode(error) !== 'EEXIST' || readDevelopmentStoreBinding(directory, context) !== journalId) throw error; return; }
  try { writeFileSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
  const parent = openSync(directory, 'r');
  try { fsyncSync(parent); } finally { closeSync(parent); }
}
