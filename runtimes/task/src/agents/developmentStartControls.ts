import type { Database } from 'bun:sqlite';
import { RunnerCommandError } from '../commandError';

interface Control { stopRequested: number; launchPermitted: number; prevented: number }
/** Called inside the journal's immediate transactions; old rows never gain a never-started proof. */
export class DevelopmentStartControls {
  constructor(private readonly db: Database) {
    db.exec('CREATE TABLE IF NOT EXISTS development_start_controls (execution_id TEXT PRIMARY KEY, stop_requested INTEGER NOT NULL DEFAULT 0 CHECK(stop_requested IN (0,1)), launch_permitted INTEGER NOT NULL DEFAULT 0 CHECK(launch_permitted IN (0,1)), prevented INTEGER NOT NULL DEFAULT 0 CHECK(prevented IN (0,1)));');
  }
  register(executionId: string): void { this.db.query('INSERT INTO development_start_controls(execution_id) VALUES(?)').run(executionId); }
  get(executionId: string): Control | null {
    return this.db.query<Control, [string]>('SELECT stop_requested AS stopRequested, launch_permitted AS launchPermitted, prevented FROM development_start_controls WHERE execution_id=?').get(executionId);
  }
  permit(executionId: string): boolean {
    const control = this.get(executionId);
    if (!control) throw new RunnerCommandError('development_usage_stop_unavailable', '原受理没有可验证的启动控制记录');
    if (control.stopRequested) return false;
    this.db.query('UPDATE development_start_controls SET launch_permitted=1 WHERE execution_id=?').run(executionId);
    return true;
  }
  stop(executionId: string, registered: boolean): boolean {
    const control = this.get(executionId);
    if (!control) {
      this.db.query('INSERT INTO development_start_controls(execution_id,stop_requested,launch_permitted) VALUES(?,1,1)').run(executionId);
      return false;
    }
    const prevented = Boolean(control.prevented || (!control.launchPermitted && registered));
    this.db.query('UPDATE development_start_controls SET stop_requested=1,prevented=? WHERE execution_id=?').run(Number(prevented), executionId);
    return prevented;
  }
}
