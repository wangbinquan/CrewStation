// 把一个 CliRuntimeAdapter 包成 CliAgentDriver：启动前核对协议与二进制，并按模式挑运行策略。

import type { AgentEvent } from '@crewstation/contracts';
import type { CliAgentDriver, DriverAgentProcess, DriverAgentSpec, DriverLaunchContext } from '../contract/agentDriver';
import { DriverStateError } from '../contract/agentDriver';
import type { CliRuntimeAdapter } from './cliRuntimeAdapter';
import type { AgentRunBase } from './agentRunBase';
import { ChainedAgentRun } from './chainedRun';
import { createAgentEventFactory } from './agentEventMapping';
import { createEventStream } from './eventStream';
import { ResidentAgentRun } from './residentRun';

/**
 * 二进制来自每次启动的 `spec.launch.binaryPath`（RFC-006 C5），驱动本身不绑定任何二进制；
 * `which` 在构造时注入（宿主传自己的 Bun.which，测试传替身），启动时用它判断那个绝对路径是否可执行。
 * 不在位就只发 driver_not_installed，不白建运行目录；协议与适配器不符（平台下发错了）同样只报错不启动。
 */
export function createCliAgentDriver(adapter: CliRuntimeAdapter, which: (binary: string) => string | null): CliAgentDriver {
  return {
    protocol: adapter.protocol,
    start: (spec, context) => {
      if (spec.launch.protocol !== adapter.protocol) return failedBeforeStart(spec, 'protocol_mismatch', `档位协议 ${spec.launch.protocol} 不能由 ${adapter.protocol} 驱动启动`);
      if (which(spec.launch.binaryPath) === null) return failedBeforeStart(spec, 'driver_not_installed', `driver binary not installed: ${spec.launch.binaryPath}`);
      return start(adapter, spec, context);
    },
  };
}

/** 启动前就能判定的失败：一条 error 事件后即结束，send／cancel 都是空操作。 */
function failedBeforeStart(spec: DriverAgentSpec, code: string, message: string): DriverAgentProcess {
  const events = createEventStream<AgentEvent>();
  const event = createAgentEventFactory(spec.agentId);
  events.push(event('error', { error: { code, message } }));
  events.close();
  return {
    events,
    send: () => Promise.reject(new DriverStateError('agent_not_running', `Agent ${spec.agentId} 未启动`)),
    cancel: () => Promise.resolve(),
  };
}

function start(adapter: CliRuntimeAdapter, spec: DriverAgentSpec, context: DriverLaunchContext): DriverAgentProcess {
  // prepare 是异步的（要建运行目录、写文件），而 start 必须同步返回一个事件流：
  // 先返回一个占位进程，装配失败时它只发一条 error 事件。
  const pending = createPendingRun(spec);
  void adapter
    .prepare(spec, context)
    .then((prepared) => {
      const resident = spec.mode === 'interactive' && adapter.supportsResidentStream;
      const run = resident
        ? new ResidentAgentRun(spec, context, prepared, adapter.protocol)
        : new ChainedAgentRun(spec, context, prepared, adapter.protocol);
      pending.attach(run);
    })
    .catch((error: unknown) => {
      pending.fail(error instanceof Error ? error.message : String(error));
    });
  return pending;
}

interface PendingRun extends DriverAgentProcess {
  attach(run: AgentRunBase): void;
  fail(message: string): void;
}

/** 装配期的门面：把真实运行的事件转发出去，并把装配前到达的 send／cancel 排到装配之后。 */
function createPendingRun(spec: DriverAgentSpec): PendingRun {
  const events = createEventStream<AgentEvent>();
  const event = createAgentEventFactory(spec.agentId);
  let attached: AgentRunBase | undefined;
  let ready: (() => void) | undefined;
  const whenReady = new Promise<void>((resolve) => {
    ready = resolve;
  });
  return {
    events,
    attach(run) {
      attached = run;
      void (async () => {
        for await (const item of run.events) events.push(item);
        events.close();
      })();
      ready?.();
    },
    fail(message) {
      events.push(event('error', { error: { code: 'driver_setup_failed', message } }));
      events.close();
      ready?.();
    },
    async send(text) {
      await whenReady;
      if (attached === undefined) return;
      await attached.send(text);
    },
    async cancel() {
      await whenReady;
      if (attached === undefined) {
        events.close();
        return;
      }
      await attached.cancel();
    },
  };
}
