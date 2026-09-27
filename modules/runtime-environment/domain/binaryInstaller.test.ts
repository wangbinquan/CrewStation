import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('二进制下载脚本校验 SHA 后才安装，失败不覆盖现有工具或输出秘密', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-binary-template-'));
  try {
    const bin = join(root, 'bin'), target = join(root, 'tool'); await mkdir(bin);
    await writeFile(target, 'original');
    // 下载边界用本地程序代替；脚本内的 sha256sum 与 install 真正运行。
    await writeFile(join(bin, 'curl'), '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "--output" ]; then printf "downloaded-binary" > "$2"; exit 0; fi; shift; done\nexit 1\n', { mode: 0o755 });
    const script = join(import.meta.dir, '../../../deploy/examples/runtime-tools/scripts/install-binary.sh');
    const run = async (url: string, hash: string) => {
      const child = Bun.spawn(['sh', script, url, hash, target], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdout: 'pipe', stderr: 'pipe' });
      return { code: await child.exited, output: await new Response(child.stderr).text() };
    };
    expect((await run('https://example.invalid/tool', '0'.repeat(64))).code).not.toBe(0);
    expect(await readFile(target, 'utf8')).toBe('original');
    expect((await run('http://example.invalid/tool', '0'.repeat(64))).code).not.toBe(0);
    const hash = new Bun.CryptoHasher('sha256').update('downloaded-binary').digest('hex');
    expect(await run('https://example.invalid/tool', hash)).toMatchObject({ code: 0 });
    expect(await readFile(target, 'utf8')).toBe('downloaded-binary');
  } finally { await rm(root, { recursive: true, force: true }); }
});
