import type { StorageControlUpdate } from '../../domain/storageControl';
import type { ControlSnapshot } from '../executionControl';

/** The sink owns its transaction; no business-task transaction remains open during delivery. */
export interface StorageControlSink { apply(update: StorageControlUpdate): Promise<boolean> }
export interface StorageControlOutbox {
  pending(limit: number): Promise<StorageControlUpdate[]>;
  acknowledge(update: StorageControlUpdate): Promise<ControlSnapshot | undefined>;
}
