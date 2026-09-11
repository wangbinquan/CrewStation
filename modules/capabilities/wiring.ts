import type { UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { Clock } from '@crewstation/kernel';
import { systemClock } from '@crewstation/kernel';
import type { Hono } from 'hono';
import type { CapabilitiesModuleApi } from './api/moduleApi';
import { describeCapabilitiesUseCase } from './application/describeCapabilities';
import { capabilityRoutes } from './http/capabilityRoutes';
import type { CapabilitySettings, CapabilitySources } from './ports/sources';

export interface CapabilitiesModuleDeps {
  sources: CapabilitySources;
  settings: CapabilitySettings;
  isAdmin: (userId: UserId) => Promise<boolean>;
  clock?: Clock;
}

export interface CapabilitiesModule {
  readonly api: CapabilitiesModuleApi;
  readonly http: Hono<AppEnv>[];
}

/** 纯聚合模块：没有自己的表，只读其他模块的公开查询。 */
export function createCapabilitiesModule(deps: CapabilitiesModuleDeps): CapabilitiesModule {
  const api: CapabilitiesModuleApi = { name: 'capabilities', describe: describeCapabilitiesUseCase(deps.sources, deps.settings, deps.clock ?? systemClock) };
  return { api, http: [capabilityRoutes(api, deps.isAdmin)] };
}
