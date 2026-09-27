import { expect, test } from 'bun:test';
import { inspectRuntimeDockerfile } from './dockerfilePolicy';

const task = { usage: 'task' as const, architecture: 'linux/amd64' as const };
test('解析多阶段、续行与注释，最终任务阶段通过 ARG 继承固定底座', () => {
  const source = 'ARG CS_BASE_IMAGE\nFROM golang:1 AS compile\nRUN go build ./...\nFROM \\\n  ${CS_BASE_IMAGE} AS tools\nCOPY --from=compile /out/tool /usr/local/bin/tool\nRUN pip install requests\nFROM tools AS final\n';
  expect(inspectRuntimeDockerfile(source, task).targetIndex).toBe(2);
  expect(inspectRuntimeDockerfile(source, { ...task, target: 'tools' }).targetIndex).toBe(1);
  expect(() => inspectRuntimeDockerfile(source, { ...task, target: 'compile' })).toThrow('必须继承');
});
test('scratch 服务可用，COPY 平台文件、未声明 ARG、替换 frontend 或硬编码错误架构拒绝', () => {
  expect(inspectRuntimeDockerfile('FROM scratch\nCOPY app /app', { ...task, usage: 'service' }).targetIndex).toBe(0);
  expect(() => inspectRuntimeDockerfile('FROM ${CS_BASE_IMAGE}', task)).toThrow('声明 ARG');
  expect(() => inspectRuntimeDockerfile('ARG CS_BASE_IMAGE\nFROM ${CS_BASE_IMAGE} AS base\nFROM alpine\nCOPY --from=base / /', task)).toThrow('必须继承');
  expect(() => inspectRuntimeDockerfile('# syntax=example/custom:latest\nARG CS_BASE_IMAGE\nFROM ${CS_BASE_IMAGE}', task)).toThrow('frontend');
  expect(() => inspectRuntimeDockerfile('ARG CS_BASE_IMAGE\nFROM --platform=linux/arm64 ${CS_BASE_IMAGE}', task)).toThrow('架构');
  expect(() => inspectRuntimeDockerfile('FROM alpine AS x\nFROM busybox AS x', { ...task, usage: 'service' })).toThrow('重复');
  expect(() => inspectRuntimeDockerfile('FROM alpine', { ...task, usage: 'service', target: 'missing' })).toThrow('target');
  expect(() => inspectRuntimeDockerfile('RUN echo no-from', task)).toThrow('FROM');
});
