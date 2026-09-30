import { expect, test } from 'bun:test';
import { jsonHash } from '@crewstation/kernel';
import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionStepResult } from '@crewstation/contracts';
import { projectResourcePhysics } from '../application/deletion/resourcePhysics';

test('Pod 与存储的独立证明皆齐才证明资源阶段；任一等待、失败或 metadata 回执都不串级', async () => {
  const calls: string[] = []; let physical = true, waiting = false;
  const step = async (name: string): Promise<ProjectDeletionStepResult> => { calls.push(name); if (waiting && name === 'pod-prove') return { kind: 'waiting', reason: 'original pod remains' }; return { kind: 'done', evidence: { kind: physical ? 'physical' : 'metadata', digest: jsonHash(name), description: 'stateful source fixture', count: 1 } }; };
  const inspect = async (): Promise<ProjectDeletionInventory> => ({ participant: 'resources', revision: jsonHash('fixture'), resources: [], references: [], blockers: [], complete: true });
  const source = projectResourcePhysics({ inspect, seal: () => step('pod-seal'), stop: () => step('pod-stop'), verify: () => step('pod-prove') }, { inspect, seal: () => step('volume-seal'), purge: () => step('volume-purge'), prove: () => step('volume-prove'), verify: () => step('volume-verify') });
  const context = { phase: 'prove' } as ProjectDeletionContext;
  waiting = true; expect((await source.prove(context)).kind).toBe('waiting'); expect(calls).toEqual(['pod-prove']);
  calls.length = 0; waiting = false; expect(await source.prove(context)).toMatchObject({ kind: 'done', evidence: { kind: 'physical', count: 2 } }); expect(calls).toEqual(['pod-prove', 'volume-prove']);
  physical = false; await expect(source.prove(context)).rejects.toThrow('实际停止');
  expect((await source.inspect({} as ProjectDeletionContext['target'])).complete).toBe(true);
});
