import { expect, test } from 'bun:test';
import type { BuildKitHistory } from '@crewstation/filesystem-metrics';
import { projectBuildHistories } from './histories';

const birth = '2026-09-30T16:00:35.872Z';
const old: BuildKitHistory = { ref: 'a'.repeat(25), event: 'complete', createdAt: '2026-09-22T06:54:10.725583337Z', completedAt: '2026-09-22T06:54:12.344072046Z', pinned: false, generation: 1, failed: false, descriptors: [], nativeIdentity: '1'.repeat(64) };
const own: BuildKitHistory = { ...old, ref: 'b'.repeat(25), createdAt: '2026-09-30T16:01:15.635953542Z', completedAt: '2026-09-30T16:01:17.375767127Z' };
test('earlier anonymous native builds stay protected in full while the original project build is selected', () => {
  const result = projectBuildHistories([{ classification: 'unattributed', history: old }, { classification: 'owned', history: own }], birth);
  expect(result.owned).toEqual([own]); expect(result.protectedHistories).toEqual([old]); expect(result.projectCreatedAt).toBe(birth);
  expect(projectBuildHistories([{ classification: 'protected', history: { ...own, event: 'started', completedAt: undefined } }], birth).protectedHistories).toHaveLength(1);
});
test('anonymous project-era, mixed, unfinished, duplicate and invalid original histories cannot be discarded', () => {
  for (const classification of ['unattributed', 'mixed'] as const) expect(() => projectBuildHistories([{ classification, history: own }], birth)).toThrow('归属不明');
  for (const history of [old, { ...own, event: 'started' as const }, { ...own, completedAt: undefined }]) expect(() => projectBuildHistories([{ classification: 'owned', history }], birth)).toThrow();
  expect(() => projectBuildHistories([{ classification: 'unattributed', history: { ...old, completedAt: birth } }], birth)).toThrow();
  expect(() => projectBuildHistories([{ classification: 'owned', history: own }, { classification: 'protected', history: own }], birth)).toThrow('不完整');
  expect(() => projectBuildHistories([], 'missing')).toThrow();
  expect(() => projectBuildHistories([{ classification: 'protected', history: { ...own, completedAt: old.completedAt } }], birth)).toThrow('顺序');
});
