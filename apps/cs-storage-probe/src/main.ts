import { createFilesystemMetricsHandler } from '@crewstation/filesystem-metrics';

const fetch = createFilesystemMetricsHandler({ token: process.env.CS_STORAGE_PROBE_TOKEN ?? '', roots: { local: process.env.CS_STORAGE_PROBE_ROOT ?? '/volumes' } });
const server = Bun.serve({ port: Number(process.env.CS_STORAGE_PROBE_PORT ?? 8095), fetch, idleTimeout: 60 });
process.on('SIGTERM', () => { void server.stop(); });
process.on('SIGINT', () => { void server.stop(); });
