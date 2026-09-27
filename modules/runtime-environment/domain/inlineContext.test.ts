import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeImageRevisionDtoSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { inlineContextScript } from './inlineContext';

test('真实准备脚本保留二进制和执行权限，文件名中的 shell 语法不会执行', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-inline-context-')), input = join(root, 'input'), context = join(root, 'context');
  try {
    await mkdir(input);
    const bytes = Buffer.from([0, 255, 128, 10]), path = "bin/tool'$(touch hacked)";
    const revision = RuntimeImageRevisionDtoSchema.parse({ id: newResourceId(), imageId: newResourceId(), revision: 1, createdBy: newResourceId(), createdAt: new Date().toISOString(), recipeDigest: `sha256:${'a'.repeat(64)}`, initializer: { steps: [], env: {}, secrets: [] }, tools: [], source: { kind: 'inline', architecture: 'linux/amd64', usage: 'service', dockerfileContent: 'FROM scratch', files: [{ path, contentBase64: bytes.toString('base64'), executable: true }, { path: 'config.txt', contentBase64: btoa('plain') }] } });
    await writeFile(join(input, 'dockerfile'), 'FROM scratch'); await writeFile(join(input, 'file-0'), bytes.toString('base64')); await writeFile(join(input, 'file-1'), btoa('plain'));
    const script = inlineContextScript(revision).replaceAll('/context-input', input).replaceAll('/workspace/context', context);
    const child = Bun.spawn(['sh', '-ec', script], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    const error = await new Response(child.stderr).text(); expect(await child.exited, error).toBe(0);
    expect(await readFile(join(context, path))).toEqual(bytes);
    expect((await stat(join(context, path))).mode & 0o777).toBe(0o755);
    expect((await stat(join(context, 'config.txt'))).mode & 0o777).toBe(0o644);
    expect(await readFile(join(context, 'Dockerfile'), 'utf8')).toBe('FROM scratch');
    await expect(stat(join(root, 'hacked'))).rejects.toThrow();
    expect(() => inlineContextScript({ ...revision, source: { kind: 'existing', usage: 'service', architecture: 'linux/amd64', reference: 'image:v1' } })).toThrow('直接编写');
  } finally { await rm(root, { recursive: true, force: true }); }
});
