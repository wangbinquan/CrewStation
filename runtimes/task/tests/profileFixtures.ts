import type { AgentProtocol, BeforeStartMaterial, LaunchSpec } from '@crewstation/contracts';

/** 预装 CLI 的位置（Dockerfile）；终端协议用一个开发机与镜像里都在的二进制。 */
export const TEST_BINARY: Record<AgentProtocol, string> = { 'claude-code': '/usr/local/bin/claude', opencode: '/usr/local/bin/opencode', terminal: '/bin/sh' };

/** 档位修订固定的二进制与参数（RFC-006 LaunchSpec）；字段按协议的适用矩阵取缺省。 */
export function launchSpec(protocol: AgentProtocol = 'claude-code', overrides: Partial<LaunchSpec> = {}): LaunchSpec {
  return { protocol, binaryPath: TEST_BINARY[protocol], extraArgs: [], isSandbox: false, ...overrides };
}

/** 档位修订的启动前材料：每次启动都有，步骤可以为空。 */
export function material(steps: BeforeStartMaterial['steps'] = [], extra: Partial<BeforeStartMaterial> = {}): BeforeStartMaterial {
  return { profile: '01a0bf5d-8f4b-7ad6-85af-678b84e2f6f6', revision: 3, contentHash: 'hash', steps, vars: {}, secrets: {}, configFile: { kind: 'none' }, captureOutput: false, ...extra };
}

/** 启动命令里档位的那一段（protocol.ts 的 ProfileLaunchShape）；经假 cs-session 发送时按 JSON 下发。 */
export function profileFields(agentId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { compute: '01a0bf5d-8f4b-7ad6-85af-678b84e2f6f6', profileRevision: 3, launch: launchSpec(), permission: 'edit', mcp: [], env: {}, beforeStart: material(), processAttemptId: `${agentId}:1`, ...overrides };
}
