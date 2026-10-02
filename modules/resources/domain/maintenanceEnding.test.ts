import { describe, expect, test } from 'bun:test';
import type { ProjectId } from '@crewstation/contracts';
import type { LedgerRecord } from './record';
import { maintenanceSnapshot, sameMaintenanceSnapshot, selectedDevelopmentRecord } from './maintenanceEnding';

const at = new Date('2026-10-02T01:00:00Z');
const record: LedgerRecord = { id: 'r', kind: 'dev-workspace', projectId: 'p' as ProjectId, owner: { module: 'task-runtime', ref: 't' },
  desired: 'present', spec: { children: [], pod: { image: 'runtime', labels: { a: '1', b: '2' } } }, generation: 3, observedGeneration: 3,
  phase: 'failed', phaseSince: at, retainUntil: at, conditions: [], children: [], display: {}, aliases: [], version: 9, createdAt: at, updatedAt: at };

describe('maintenance immutable owner snapshot', () => {
  test('jsonb key order is neutral, actual spec and all owner/version bindings are not', () => {
    const snapshot = maintenanceSnapshot(record);
    expect(sameMaintenanceSnapshot({ ...record, spec: { pod: { labels: { b: '2', a: '1' }, image: 'runtime' }, children: [] } }, snapshot)).toBe(true);
    for (const changed of [
      { ...record, projectId: 'other' as ProjectId }, { ...record, owner: { ...record.owner, ref: 'other' } },
      { ...record, kind: 'business-workspace' as const }, { ...record, generation: 4 }, { ...record, version: 10 },
      { ...record, retainUntil: new Date(at.getTime() + 1) }, { ...record, phaseSince: new Date(at.getTime() + 1) },
      { ...record, spec: { ...record.spec, pod: { image: 'replacement' } } },
    ]) expect(sameMaintenanceSnapshot(changed, snapshot)).toBe(false);
  });
  test('malformed selection presence still requires owner; ordinary legacy and other owners remain separate', () => {
    expect(selectedDevelopmentRecord(record)).toBe(false);
    for (const spec of [{ children: [], developmentParentEnding: null }, { children: [], pod: { developmentUsageProtection: false } },
      { children: [], pod: { developmentRemovalProtection: {} } }, { children: [], rebuild: { developmentParentSelection: null } }]) {
      expect(selectedDevelopmentRecord({ ...record, spec })).toBe(true);
      expect(selectedDevelopmentRecord({ ...record, owner: { module: 'release', ref: 'r' }, spec })).toBe(false);
    }
  });
});
