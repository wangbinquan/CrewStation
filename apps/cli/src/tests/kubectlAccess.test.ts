import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKubectlAccess } from '../cluster/kubectlAccess';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** 打桩的 kubectl：先打出参数，再把标准输入原样打出来；带 fail 参数时以 stderr 失败。 */
function stubKubectl(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cs-cli-kubectl-'));
  dirs.push(dir);
  const binary = join(dir, 'kubectl');
  writeFileSync(binary, '#!/bin/bash\nif [ "${@: -1}" = fail ]; then echo "error: boom" >&2; exit 3; fi\necho "args: $*"\ncat\n');
  chmodSync(binary, 0o755);
  return binary;
}

test('带上上下文；input 经标准输入交给 kubectl（apply -f - 的清单）；没有 input 时标准输入是空的', async () => {
  const access = createKubectlAccess({ context: 'kind-x', binary: stubKubectl() });
  expect(access.target).toEndWith('kubectl --context kind-x');
  const applied = await access.run(['apply', '-f', '-'], '{"kind":"List"}');
  expect(applied).toEqual({ code: 0, stdout: 'args: --context kind-x apply -f -\n{"kind":"List"}', stderr: '' });
  expect((await access.run(['get', 'ns'])).stdout).toBe('args: --context kind-x get ns\n');
});

test('kubectl 失败如实带回退出码与 stderr；二进制不存在时退出码 127 并说明原因', async () => {
  const access = createKubectlAccess({ context: undefined, binary: stubKubectl() });
  expect(await access.run(['fail'])).toEqual({ code: 3, stdout: '', stderr: 'error: boom\n' });
  const missing = await createKubectlAccess({ context: undefined, binary: '/nonexistent/kubectl' }).run(['version']);
  expect(missing.code).toBe(127);
  expect(missing.stderr).toContain('无法执行 /nonexistent/kubectl');
});
