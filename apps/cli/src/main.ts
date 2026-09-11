#!/usr/bin/env bun
// crewstation 命令行进程入口：只把 process 的一切注入 runCli。解析、分发与命令逻辑都在 src/runtime 与 src/commands。
import { homedir } from 'node:os';
import { runCli } from './runtime/dispatch';
import { createLocalFiles } from './runtime/localFiles';

const code = await runCli({
  argv: process.argv.slice(2),
  env: process.env,
  io: {
    out: (line) => { process.stdout.write(line + '\n'); },
    err: (line) => { process.stderr.write(line + '\n'); },
  },
  isTty: process.stdout.isTTY === true,
  homeDir: homedir(),
  files: createLocalFiles(),
  fetch: (input, init) => globalThis.fetch(input, init),
});

process.exit(code);
