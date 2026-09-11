import type { AgentDriver as AgentDriverName } from '@crewstation/contracts';
import { createCliDriver } from './cliDriver';
import type { AgentDriver } from './driver';
import { createStubDriver } from './stubDriver';

export interface DriverRegistry {
  get(name: AgentDriverName): AgentDriver | undefined;
  /** 可实际运行的驱动名，写进 hello 的 capabilities.drivers。 */
  available(): AgentDriverName[];
  names(): AgentDriverName[];
}

/** 内建驱动：确定性的 stub，加上两个 CLI 的占位驱动；真实 CLI 驱动接入时替换这里的两项即可。 */
export function defaultDrivers(): AgentDriver[] {
  return [createStubDriver(), createCliDriver({ name: 'claude-code', binary: 'claude' }), createCliDriver({ name: 'opencode', binary: 'opencode' })];
}

export function createDriverRegistry(drivers: AgentDriver[] = defaultDrivers()): DriverRegistry {
  const byName = new Map<AgentDriverName, AgentDriver>();
  for (const driver of drivers) {
    if (byName.has(driver.name)) throw new Error(`驱动 ${driver.name} 重复注册`);
    byName.set(driver.name, driver);
  }
  return {
    get: (name) => byName.get(name),
    available: () => [...byName.values()].filter((d) => d.available()).map((d) => d.name),
    names: () => [...byName.keys()],
  };
}
