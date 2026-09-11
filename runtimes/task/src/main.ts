// TaskRunner 入口：任务容器内常驻进程。以 root 启动（Dockerfile），每个 Agent／终端／exec／预览子进程经 setpriv 降到 worker；
// 出向连接 cs-session，实现 packages/contracts/taskrunner/protocol.ts 的全部命令（Design §5.6、§10；裁定 G5、G6、G25）。
import { createJsonLogger } from '@crewstation/kernel';
import { loadConfigFromEnv } from './config';
import { startRunner } from './runner';

const config = loadConfigFromEnv();
const logger = createJsonLogger({ service: 'taskrunner', taskId: config.taskId });
const runner = await startRunner({ ...config, logger });

const onSignal = (signal: string): void => {
  logger.info('signal received, shutting down', { signal });
  void runner.shutdown(30);
};
process.on('SIGTERM', () => onSignal('SIGTERM'));
process.on('SIGINT', () => onSignal('SIGINT'));
