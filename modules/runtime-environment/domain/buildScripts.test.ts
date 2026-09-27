import { expect, test } from 'bun:test';
import { RuntimeImageRevisionDtoSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { imageCheckoutScript, imageClientScript, imageDaemonScript, shellArg } from './buildScripts';

const revision = RuntimeImageRevisionDtoSchema.parse({ id: newResourceId(), imageId: newResourceId(), revision: 1, createdBy: newResourceId(), createdAt: '2026-09-27T00:00:00Z', recipeDigest: `sha256:${'a'.repeat(64)}`, commitSha: 'c'.repeat(40), baseImage: `registry.internal:5000/crewstation/task@sha256:${'b'.repeat(64)}`, initializer: { steps: [], env: {}, secrets: [] }, tools: [], source: { kind: 'source', repositoryBindingId: newResourceId(), ref: 'main', architecture: 'linux/amd64', usage: 'task', context: 'tools', dockerfile: 'Dockerfile', target: 'final', buildArgs: { TEST: "'; echo injected; #\n$(false)" }, secrets: [{ id: 'npm', configDefinitionId: newResourceId(), environment: 'development' }] } });
test('构建脚本是合法 shell，参数包含引号、换行、命令替换时仍按字面传入', async () => {
  const scripts = [imageCheckoutScript('https://git.example/project.git', revision), imageClientScript(revision, 'registry.test/runtime/projects/p1/build:artifact', true), imageDaemonScript('registry.internal:5000', true)];
  for (const script of scripts) {
    const process = Bun.spawn(['sh', '-n'], { stdin: new Blob([script]), stdout: 'pipe', stderr: 'pipe' });
    const error = await new Response(process.stderr).text(); expect(await process.exited, error).toBe(0);
  }
  const values = ["'; echo injected; #", '$(false)', '`false`', 'line1\nline2', ''];
  for (const value of values) {
    const process = Bun.spawn(['sh', '-c', `printf '%s' ${shellArg(value)}`], { stdout: 'pipe', stderr: 'pipe' });
    expect(await new Response(process.stdout).text()).toBe(value); expect(await process.exited).toBe(0);
  }
  expect(scripts[0]).toContain('rev-parse FETCH_HEAD'); expect(scripts[0]).toContain('archive --format=tar FETCH_HEAD');
  expect(scripts[1]).toContain('id=npm,src=/build-secrets/npm'); expect(scripts[1]).not.toContain('git-auth');
  // BuildKit interprets even an empty BUILDKIT_SYNTAX option as an external frontend reference.
  expect(scripts[1]).toContain("'--frontend' 'dockerfile.v0'"); expect(scripts[1]).not.toContain('build-arg:BUILDKIT_SYNTAX=');
  expect(scripts[2]).not.toContain('tcp://');
});
test('内嵌凭据 URL 与非法仓库主机在生成脚本前被拒绝', () => {
  expect(() => imageCheckoutScript('https://user:secret@git.example/p.git', revision)).toThrow('内嵌凭据');
  expect(() => imageDaemonScript('registry\nmalicious', true)).toThrow('不合法');
});

test('最大转义构建参数在受理后仍满足内部脚本命令容量', async () => {
  const { RuntimeImageBuildRenderSchema, RuntimeImageSourceSchema } = await import('@crewstation/contracts');
  const source = RuntimeImageSourceSchema.parse({ ...revision.source, buildArgs: { QUOTED: "'".repeat(8000) } });
  const command = ['sh', '-ec', imageClientScript({ ...revision, source }, 'registry.test/runtime/projects/p1/build:artifact', true)];
  expect(command[2]!.length).toBeGreaterThan(8192);
  expect(RuntimeImageBuildRenderSchema.shape.clientCommand.safeParse(command).success).toBe(true);
  expect(RuntimeImageBuildRenderSchema.shape.clientCommand.safeParse(['sh', '-c', '中'.repeat(22000)]).success).toBe(false);
});
