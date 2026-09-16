import type { AgentDriver, RuntimeDriver } from '@crewstation/contracts';

/**
 * 驱动下拉的取值（RFC-001）。用 Record 而不是数组字面量：contracts 里的驱动枚举一旦增删这里会编译失败，
 * 不会出现管理页少一个驱动而没人发现。值为 null 只是占位，键才是取值。
 */
const DRIVERS: Readonly<Record<AgentDriver, null>> = { 'claude-code': null, opencode: null, stub: null };

export const COMPUTE_DRIVERS = Object.keys(DRIVERS) as readonly AgentDriver[];

/** 运行环境只针对真实 CLI（RFC-004）：stub 没有配置文件可写。 */
const RUNTIME: Readonly<Record<RuntimeDriver, null>> = { 'claude-code': null, opencode: null };

export const RUNTIME_DRIVERS = Object.keys(RUNTIME) as readonly RuntimeDriver[];
