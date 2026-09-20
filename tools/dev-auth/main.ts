#!/usr/bin/env bun
import { startDevAuthServer } from './server';

const server = await startDevAuthServer();
console.log(`[dev-auth] 页面 ${server.publicOrigin}/ · 监听 0.0.0.0:${server.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.stop();
    process.exit(0);
  });
}
