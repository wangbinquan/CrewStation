/**
 * 用例能力闸门（docs/engineering/testing.md §5）。
 *
 * 依赖外部环境的用例在环境缺席时跳过——这在开发机上是对的，在 CI 上却是漏洞：
 * 数据库服务没起来，整层集成用例静默跳过，门禁照绿。`CS_TEST_REQUIRE` 列出本次运行
 * **必须具备**的能力（逗号分隔）；被点名的能力缺席时抛错，让用例文件在加载期就红，而不是跳过。
 *
 * 本文件零依赖：仓库根 `tests/` 不是工作区单元，只能按相对路径引用它。
 */
export const TEST_CAPABILITIES = ['database', 'gitlab', 'e2e'] as const;
export type TestCapability = (typeof TEST_CAPABILITIES)[number];

type Env = Readonly<Record<string, string | undefined>>;

/** 解析 CS_TEST_REQUIRE；写错的能力名直接报错——拼错一个字就等于悄悄关掉这道闸。 */
export function requiredTestCapabilities(env: Env = process.env): ReadonlySet<TestCapability> {
  const names = (env.CS_TEST_REQUIRE ?? '').split(',').map((name) => name.trim()).filter((name) => name.length > 0);
  const unknown = names.filter((name) => !(TEST_CAPABILITIES as readonly string[]).includes(name));
  if (unknown.length > 0) {
    throw new Error(`CS_TEST_REQUIRE 含未知能力 ${unknown.join('、')}；可用：${TEST_CAPABILITIES.join('、')}`);
  }
  return new Set(names as TestCapability[]);
}

/**
 * 把一次环境探测的结果变成「跑／跳过／报错」三选一：
 * 可用 → true；不可用且未被要求 → 打一行告警并返回 false（调用方据此 skipIf）；
 * 不可用但被 CS_TEST_REQUIRE 点名 → 抛错。
 */
export function resolveCapability(capability: TestCapability, available: boolean, detail: string, env: Env = process.env): boolean {
  if (available) return true;
  if (requiredTestCapabilities(env).has(capability)) {
    throw new Error(`CS_TEST_REQUIRE 要求能力「${capability}」，但它不可用：${detail}。这次运行不允许跳过依赖它的用例。`);
  }
  console.warn(`[testkit] 能力「${capability}」不可用，依赖它的用例将跳过：${detail}`);
  return false;
}
