import { expect, test } from 'bun:test';
import type * as Api from '../api/types';
import type { ConditionUpdate } from '../domain/conditions';
import type { ExpectedChild, LedgerRecord, RecordFilter, ResourceAlias, ResourceSpec } from '../domain/record';

/** 两个类型互相可赋值才算一致；改了一边忘了另一边，这里编译失败（bun run typecheck）。 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

test('对外类型（api/）与领域类型（domain/）同形：模板规定两边互不 import，由这里在编译期核对', () => {
  const agree: [
    Same<Api.LedgerRecord, LedgerRecord>, Same<Api.ExpectedChild, ExpectedChild>, Same<Api.ResourceSpec, ResourceSpec>,
    Same<Api.ResourceAlias, ResourceAlias>, Same<Api.ConditionUpdate, ConditionUpdate>, Same<Api.RecordFilter, RecordFilter>,
  ] = [true, true, true, true, true, true];
  expect(agree.every(Boolean)).toBe(true);
});
