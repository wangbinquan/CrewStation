// 把一个 CliRuntimeAdapter 包成 CliAgentDriver：决定 available()，并按模式挑运行策略。

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
 * `available()` 要解析 PATH 才能回答，而 CliAgentDriver 的签名里没有 ProcessHost，
 * 所以 `which` 在构造时注入（宿主传自己的 Bun.which，测试传替身）。
 * 它决定 hello 的 capabilities.drivers：二进制不在就不宣告，`start` 也直接报 driver_not_installed，
 * 不白建运行目录。
 */
export function createCliAgentDriver(adapter: CliRuntimeAdapter, which: (binary: string) => string | null): CliAgentDriver {
  return {
    name: adapter.name,
    available: () => which(adapter.binary) !== null,
    start: (spec, context) => {
      if (which(adapter.binary) === null) return notInstalled(adapter.binary, spec);
      return start(adapter, spec, context);
    },
  };
}

/** 二进制不在位：一条 error 事件后即结束，send／cancel 都是空操作。 */
function notInstalled(binary: string, spec: DriverAgentSpec): DriverAgentProcess {
  const events = createEventStream<AgentEvent>();
  const event = createAgentEventFactory(spec.agentId);
  events.push(event('error', { error: { code: 'driver_not_installed', message: `driver binary not installed: ${binary}` } }));
  events.close();
  return {
    events,
    send: () => Promise.reject(new DriverStateError('agent_not_running', `driver ${binary} 未启动`)),
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
        ? new ResidentAgentRun(spec, context, prepared, adapter.name)
        : new ChainedAgentRun(spec, context, prepared, adapter.name);
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
