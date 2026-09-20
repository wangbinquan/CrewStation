import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ContractSurface } from './contractSurface';
import { buildContractSurface, surfaceSchema } from './contractSurface';
import { describeDrift, diffSurface } from './surfaceDiff';
import { lockSurface, readGolden } from './surfaceGolden';

describe('业务契约面金样', () => {
  // 平台侧改一个头名、删一个 Manifest 字段、让请求体多一个必填项，平台自己的用例可以全绿——
  // 红的是已经部署的数字人。金样把这类改动变成一次看得见、要给依据的动作。
  test('当前契约面与金样一致', () => {
    const golden = readGolden();
    if (!golden) throw new Error('缺少金样 packages/contracts/tests/golden/contractSurface.json；运行 bun run contracts:lock');
    const drift = diffSurface(golden.surface, buildContractSurface());
    if (drift.additive.length + drift.breaking.length > 0) throw new Error(describeDrift(drift));
  });

  test('金样覆盖业务接入约定表的全部常量组与业务任务、事件、Manifest 的形状', () => {
    const surface = buildContractSurface();
    expect(Object.keys(surface.constants).sort()).toEqual(['EVENT_HEADERS', 'HOST_PATTERNS', 'IDENTITY_HEADERS', 'PLATFORM_ENV', 'PLATFORM_PATHS', 'PLATFORM_SERVICE_HOSTS', 'TASKRUNNER', 'TOKEN_CLAIMS']);
    expect(surface.constants.IDENTITY_HEADERS?.userId).toBe('x-cs-user-id');
    expect(Object.keys(surface.schemas).sort()).toEqual(['BusinessTaskDto', 'CreateBusinessTaskRequest', 'EventDelivery', 'Manifest', 'ProducedEvent', 'SubmitSubtaskRequest', 'SubtaskDto', 'SubtaskMessageRequest']);
  });
});

describe('bun run contracts:lock 的入锁规则', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crewstation-surface-lock-'));
  const path = join(dir, 'golden', 'contractSurface.json');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const surface = (headers: Record<string, string>, request: z.ZodType): ContractSurface => ({
    constants: { HEADERS: headers },
    schemas: { Request: surfaceSchema(request, 'business-to-platform') },
  });
  const first = surface({ userId: 'x-cs-user-id' }, z.object({ name: z.string() }));
  const text = (): string => readFileSync(path, 'utf8');

  // 共用一份临时金样、按顺序推进：建锁 → 无变化 → 纯新增 → 破坏性被拒 → 带依据入锁。
  test('首次建锁不要求依据', () => {
    expect(lockSurface(first, { today: '2026-09-20', path }).status).toBe('locked');
    expect(readGolden(path)?.breakingChanges).toEqual([]);
  });

  test('没有变化时不重写金样', () => {
    const before = text();
    expect(lockSurface(first, { today: '2026-09-21', path }).status).toBe('unchanged');
    expect(text()).toBe(before);
  });

  test('纯新增直接入锁', () => {
    const next = surface({ userId: 'x-cs-user-id', traceId: 'x-cs-trace-id' }, z.object({ name: z.string(), note: z.string().optional() }));
    const outcome = lockSurface(next, { today: '2026-09-21', path });
    expect(outcome.status).toBe('locked');
    expect(outcome.drift.breaking).toEqual([]);
    expect(readGolden(path)?.surface.constants.HEADERS).toEqual({ userId: 'x-cs-user-id', traceId: 'x-cs-trace-id' });
  });

  test('破坏性变化没有依据：拒绝，金样一个字节都不动；空白依据同样不算', () => {
    const before = text();
    const renamed = surface({ userId: 'x-cs-uid', traceId: 'x-cs-trace-id' }, z.object({ name: z.string(), note: z.string().optional() }));
    expect(lockSurface(renamed, { today: '2026-09-22', path }).status).toBe('refused');
    expect(lockSurface(renamed, { today: '2026-09-22', path, breakingBasis: '   ' }).status).toBe('refused');
    expect(text()).toBe(before);
  });

  test('带依据入锁：依据、日期与逐条变化留痕，此前的记录保留', () => {
    const renamed = surface({ userId: 'x-cs-uid', traceId: 'x-cs-trace-id' }, z.object({ name: z.string(), note: z.string().optional() }));
    expect(lockSurface(renamed, { today: '2026-09-22', path, breakingBasis: 'RFC-099 能力影响清单第 1 项' }).status).toBe('locked');
    const removed = surface({ traceId: 'x-cs-trace-id' }, z.object({ name: z.string(), note: z.string().optional() }));
    expect(lockSurface(removed, { today: '2026-09-23', path, breakingBasis: 'RFC-100' }).status).toBe('locked');
    expect(readGolden(path)?.breakingChanges).toEqual([
      { date: '2026-09-22', basis: 'RFC-099 能力影响清单第 1 项', changes: ['～ constants/HEADERS/userId："x-cs-user-id" → "x-cs-uid"'] },
      { date: '2026-09-23', basis: 'RFC-100', changes: ['－ constants/HEADERS/userId（原值 "x-cs-uid"）'] },
    ]);
  });
});
