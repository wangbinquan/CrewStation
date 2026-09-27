import { expect, test } from 'bun:test';
import type { ReleaseId, ServiceId } from '@crewstation/contracts';
import { ManifestSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import type { Release } from '../../domain/release';
import { loadExecutionMaterials } from './executionMaterials';

function fixture(prompt = 'prompts/agent.md') {
  const manifest = ManifestSchema.parse({ apiVersion: 'crewstation/v2', kind: 'DigitalWorker', spec: { service: { command: ['app'], port: 3000, servicePlanId: newResourceId() }, tasks: { taskProfileId: newResourceId(), agentProfiles: [{ id: newResourceId(), name: 'review', compute: { kind: 'default' }, systemPromptFile: prompt }], outputContracts: [{ id: newResourceId(), name: 'result', required: ['result.json'], schema: 'schema.json' }] } } });
  const release = { id: newResourceId() as ReleaseId, serviceId: newResourceId() as ServiceId, commitSha: 'c'.repeat(40), pipeline: { step: 1 } } as Release;
  const files: Record<string, string> = { 'prompts/agent.md': 'fixed prompt', 'schema.json': '{"type":"object"}' }, reads: string[][] = [];
  const repo = { readFile: async (_id: ServiceId, ref: string, path: string) => { reads.push([ref, path]); return files[path]; }, repositoryUrl: async () => ({ httpUrl: '', credentialSecretName: '' }) };
  return { manifest, release, files, reads, repo };
}
test('release files are read from fixed commit once; persisted content survives changed repository responses', async () => {
  const f = fixture(), content = await loadExecutionMaterials(f.repo, f.release, f.manifest);
  expect(content).toEqual(f.files); expect(f.reads.map(([ref]) => ref)).toEqual(['c'.repeat(40), 'c'.repeat(40)]);
  f.files['prompts/agent.md'] = 'new default';
  expect(await loadExecutionMaterials(f.repo, { ...f.release, pipeline: { ...f.release.pipeline, executionMaterials: content } }, f.manifest)).toEqual(content);
  expect(f.reads).toHaveLength(2);
});
test('missing, traversal, oversized and invalid schema files fail release before deployment', async () => {
  const f = fixture(); delete f.files['prompts/agent.md'];
  await expect(loadExecutionMaterials(f.repo, f.release, f.manifest)).rejects.toThrow('缺少执行文件');
  const bad = fixture('../escape'); await expect(loadExecutionMaterials(bad.repo, bad.release, bad.manifest)).rejects.toThrow('安全相对路径');
  const large = fixture(); large.files['prompts/agent.md'] = 'x'.repeat(1_048_577); await expect(loadExecutionMaterials(large.repo, large.release, large.manifest)).rejects.toThrow('字节上限');
  const schema = fixture(); schema.files['schema.json'] = 'not json'; await expect(loadExecutionMaterials(schema.repo, schema.release, schema.manifest)).rejects.toThrow('有效 JSON');
});
