// TaskRunner 入口：以独立用户运行，出向连接 cs-session；实现随 T0.4 原型进入。
import { CONTRACTS_VERSION } from '@crewstation/contracts';
import { createJsonLogger } from '@crewstation/kernel';

const logger = createJsonLogger({ service: 'taskrunner' });
logger.info('taskrunner skeleton', { contracts: CONTRACTS_VERSION });
