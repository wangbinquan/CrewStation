import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type { ContractSurface, SurfaceDirection } from './contractSurface';
import { surfaceSchema } from './contractSurface';
import { describeDrift, diffSurface } from './surfaceDiff';

const withSchema = (schema: z.ZodType, direction: SurfaceDirection): ContractSurface => ({ constants: {}, schemas: { Sample: surfaceSchema(schema, direction) } });
const withConstants = (headers: Record<string, string>): ContractSurface => ({ constants: { HEADERS: headers }, schemas: {} });
const sent = (before: z.ZodType, after: z.ZodType) => diffSurface(withSchema(before, 'business-to-platform'), withSchema(after, 'business-to-platform'));
const received = (before: z.ZodType, after: z.ZodType) => diffSurface(withSchema(before, 'platform-to-business'), withSchema(after, 'platform-to-business'));

const request = z.object({ name: z.string(), mode: z.enum(['oneshot', 'interactive']) }).strict();
const dto = z.object({ id: z.string(), state: z.enum(['running', 'closed']) });

describe('常量：业务按名字依赖，新增无害，删与改都是破坏', () => {
  test('新增一个头', () => {
    const drift = diffSurface(withConstants({ userId: 'x-cs-user-id' }), withConstants({ userId: 'x-cs-user-id', traceId: 'x-cs-trace-id' }));
    expect(drift).toEqual({ additive: ['＋ constants/HEADERS/traceId = "x-cs-trace-id"'], breaking: [] });
  });
  test('改名与删除', () => {
    expect(diffSurface(withConstants({ userId: 'x-cs-user-id' }), withConstants({ userId: 'x-cs-uid' })).breaking).toEqual(['～ constants/HEADERS/userId："x-cs-user-id" → "x-cs-uid"']);
    expect(diffSurface(withConstants({ userId: 'x-cs-user-id' }), withConstants({})).breaking).toEqual(['－ constants/HEADERS/userId（原值 "x-cs-user-id"）']);
  });
});

describe('业务发给平台的数据（Manifest、请求体）：平台开始拒收原先接受的输入才是破坏', () => {
  test('新增可选字段、多接受一种取值：纯新增', () => {
    const drift = sent(request, request.extend({ note: z.string().optional(), mode: z.enum(['oneshot', 'interactive', 'batch']) }));
    expect(drift.breaking).toEqual([]);
    expect(drift.additive.join('\n')).toContain('properties/note');
    expect(drift.additive.join('\n')).toContain('enum{batch}');
  });
  test('新增必填字段：既有业务没给它，会被拒', () => {
    expect(sent(request, request.extend({ owner: z.string() })).breaking.join('\n')).toContain('required{owner}');
  });
  test('删字段、少接受一种取值、收紧长度、由宽松改成 strict', () => {
    expect(sent(request, request.omit({ mode: true })).breaking.join('\n')).toContain('－ schemas/Sample/properties/mode');
    expect(sent(request, request.extend({ mode: z.enum(['oneshot']) })).breaking.join('\n')).toContain('enum{interactive}');
    expect(sent(request, request.extend({ name: z.string().max(10) })).breaking.join('\n')).toContain('maxLength');
    expect(sent(z.object({ name: z.string() }), z.object({ name: z.string() }).strict()).breaking.join('\n')).toContain('additionalProperties');
  });
  test('改类型', () => {
    expect(sent(request, request.extend({ name: z.number() })).breaking.join('\n')).toContain('"string" → "number"');
  });
});

describe('平台发给业务的数据（事件信封、DTO）：业务收到它不认识的东西才是破坏', () => {
  test('多给一个字段：纯新增', () => {
    expect(received(dto, dto.extend({ traceId: z.string() }))).toMatchObject({ breaking: [] });
  });
  test('新状态值、可能为 null、多一种联合分支：业务的分支判断会漏', () => {
    expect(received(dto, dto.extend({ state: z.enum(['running', 'closed', 'paused']) })).breaking.join('\n')).toContain('enum{paused}');
    expect(received(dto, dto.extend({ id: z.string().nullable() })).breaking.length).toBeGreaterThan(0);
    const union = z.discriminatedUnion('kind', [z.object({ kind: z.literal('agent') }), z.object({ kind: z.literal('command') })]);
    const wider = z.discriminatedUnion('kind', [z.object({ kind: z.literal('agent') }), z.object({ kind: z.literal('command') }), z.object({ kind: z.literal('script') })]);
    expect(received(union, wider).breaking.join('\n')).toMatch(/(anyOf|oneOf)\[2\]/);
  });
  test('少给一个字段', () => {
    expect(received(dto, dto.omit({ state: true })).breaking.join('\n')).toContain('－ schemas/Sample/properties/state');
  });
});

describe('不算变化的改动与整份 Schema 的增删', () => {
  test('只调换字段与枚举的声明顺序', () => {
    const reordered = z.object({ mode: z.enum(['interactive', 'oneshot']), name: z.string() }).strict();
    expect(sent(request, reordered)).toEqual({ additive: [], breaking: [] });
  });
  test('新增一份 Schema 是新增，删掉一份是破坏', () => {
    const none: ContractSurface = { constants: {}, schemas: {} };
    expect(diffSurface(none, withSchema(dto, 'platform-to-business'))).toEqual({ additive: ['＋ schemas/Sample'], breaking: [] });
    expect(diffSurface(withSchema(dto, 'platform-to-business'), none)).toEqual({ additive: [], breaking: ['－ schemas/Sample'] });
  });
});

describe('失败时给出的说明', () => {
  test('破坏性变化写明要先有依据，纯新增写明直接入锁的命令', () => {
    expect(describeDrift({ additive: [], breaking: ['－ x'] })).toContain('bun run contracts:lock --breaking "<依据>"');
    const additiveOnly = describeDrift({ additive: ['＋ y'], breaking: [] });
    expect(additiveOnly).toContain('bun run contracts:lock');
    expect(additiveOnly).not.toContain('--breaking');
  });
});
