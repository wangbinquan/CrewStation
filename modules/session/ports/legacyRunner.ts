import type { RunnerHello } from '@crewstation/contracts';
import type { LegacyRunnerBridge } from '../domain/runnerConnection';
export type { LegacyRunnerBridge } from '../domain/runnerConnection';
export interface LegacyRunnerBoundary {
  normalizeTask?(raw: unknown): Promise<unknown>;
  hello(raw: unknown): Promise<{ hello: RunnerHello; bridge: LegacyRunnerBridge } | undefined>;
}
