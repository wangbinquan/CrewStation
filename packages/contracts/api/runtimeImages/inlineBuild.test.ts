import { expect, test } from 'bun:test';
import { CreateRuntimeImageRevisionSchema, RuntimeImageSourceSchema } from './requests';

const input = () => ({ kind: 'inline', dockerfileContent: 'ARG CS_BASE_IMAGE\nFROM ${CS_BASE_IMAGE}\nCOPY check.sh /usr/local/bin/check', architecture: 'linux/amd64', usage: 'task', files: [{ path: 'check.sh', contentBase64: btoa('#!/bin/sh\nprintf ready'), executable: true }] });

test('直接编写配方没有业务或仓库，固定 Dockerfile、二进制文件和普通构建参数', () => {
  const result = CreateRuntimeImageRevisionSchema.parse({ source: input() });
  expect(result).not.toHaveProperty('sourceProjectId');
  expect(result.source).toMatchObject({ ...input(), buildArgs: {} });
  expect(RuntimeImageSourceSchema.parse({ ...input(), files: [{ path: 'tool.bin', contentBase64: btoa('\0\xff\x80') }] })).toMatchObject({ files: [{ executable: false }] });
  expect(RuntimeImageSourceSchema.safeParse({ ...input(), repositoryBindingId: 'unused' }).success).toBe(false);
  expect(RuntimeImageSourceSchema.safeParse({ ...input(), secrets: [] }).success).toBe(false);
});

test('构建文件拒绝越界、保留路径、重复、父子冲突和非规范编码', () => {
  for (const path of ['/etc/passwd', '../escape', 'a/../b', './a', 'a//b', 'a\\b', 'Dockerfile', '.dockerignore', '.git/config', 'a\0b']) {
    expect(RuntimeImageSourceSchema.safeParse({ ...input(), files: [{ path, contentBase64: '' }] }).success).toBe(false);
  }
  for (const paths of [['a', 'a'], ['a', 'a/b'], ['a/b', 'a']]) {
    expect(RuntimeImageSourceSchema.safeParse({ ...input(), files: paths.map((path) => ({ path, contentBase64: '' })) }).success).toBe(false);
  }
  for (const contentBase64 of ['%%%%', 'Zg', 'Zh==', 'Zg==\n']) {
    expect(RuntimeImageSourceSchema.safeParse({ ...input(), files: [{ path: 'file', contentBase64 }] }).success).toBe(false);
  }
});

test('构建输入按字节限制，边界允许，超限在受理前拒绝', () => {
  const source = input(), file = (bytes: number) => ({ path: 'data', contentBase64: btoa('a'.repeat(bytes)) });
  expect(RuntimeImageSourceSchema.safeParse({ ...source, files: [file(512 * 1024)] }).success).toBe(true);
  expect(RuntimeImageSourceSchema.safeParse({ ...source, files: [file(512 * 1024 + 1)] }).success).toBe(false);
  expect(RuntimeImageSourceSchema.safeParse({ ...source, files: [file(300 * 1024), { ...file(300 * 1024), path: 'second' }] }).success).toBe(false);
  expect(RuntimeImageSourceSchema.safeParse({ ...source, files: Array.from({ length: 33 }, (_, i) => ({ path: String(i), contentBase64: '' })) }).success).toBe(false);
  expect(RuntimeImageSourceSchema.safeParse({ ...source, dockerfileContent: 'x'.repeat(256 * 1024) }).success).toBe(true);
  for (const dockerfileContent of ['', '   ', 'FROM scratch\0', '中'.repeat(90 * 1024)]) expect(RuntimeImageSourceSchema.safeParse({ ...source, dockerfileContent }).success).toBe(false);
});
