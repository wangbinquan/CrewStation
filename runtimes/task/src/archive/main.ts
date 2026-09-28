import { archiveClient } from './client';
import { executeArchive } from './execute';
import { storageContractCommand } from '../storage/storageContract';

const storageContract = storageContractCommand(process.argv.slice(2), 'archive-helper');
if (storageContract) { console.log(JSON.stringify(storageContract)); process.exit(0); }

const stop = new AbortController();
process.on('SIGTERM', () => stop.abort()); process.on('SIGINT', () => stop.abort());
const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(40 * 60_000)]);
try {
  const client = archiveClient(process.env['CS_ARCHIVE_URL'] ?? '', process.env['CS_ARCHIVE_TOKEN'] ?? '', signal, process.env['CS_RUNTIME_POD_UID'] ?? '');
  delete process.env['CS_ARCHIVE_TOKEN'];
  const files = await executeArchive(client, '/work', signal);
  process.stdout.write(`归档文件已交由平台验证：${files}\n`);
} catch (error) {
  process.stderr.write(`${signal.aborted ? '归档助手已停止，原工作卷继续保留' : error instanceof Error ? error.message : '归档助手执行失败'}\n`);
  process.exitCode = 1;
}
