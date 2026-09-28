import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCapability } from '@crewstation/testkit';
import { probeObjectBucket } from '../adapters/http/objectProbe';
import type { ObjectEndpointConfig } from '../ports/objectPlane';

export const GARAGE_TEST_IMAGE = process.arch === 'arm64'
  ? 'dxflrs/garage@sha256:2749e37137dae41459f49955e8082951f4a1ebea4e25d153182039f20a4b5974'
  : 'dxflrs/garage@sha256:0d7c74fc8ca6fef68a5a941c0e7558c8b1e92ba3588fa7505400e1350456c796';
export const garageAvailable = resolveCapability('garage', process.env.CS_TEST_GARAGE === '1' && !!Bun.which('docker'), 'Enable CS_TEST_GARAGE=1 with Docker for an isolated Garage v2.4.1 test');
async function docker(args: string[]): Promise<string> {
  const proc = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [status, output] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (status) throw new Error(`Isolated Garage Docker command failed (${args[0]}, exit ${status})`);
  return output.trim();
}
export async function startGarage() {
  const directory = await mkdtemp(join(tmpdir(), 'cs-rfc035-garage-')), name = `cs-rfc035-garage-${Bun.randomUUIDv7()}`;
  const adminToken = randomBytes(32).toString('hex');
  const config: { -readonly [K in keyof ObjectEndpointConfig]: ObjectEndpointConfig[K] } = { endpoint: '', region: 'garage', bucket: 'crewstation-objects', accessKeyId: `GK${randomBytes(16).toString('hex')}`, secretAccessKey: randomBytes(32).toString('hex') };
  const dispose = async () => { await docker(['rm', '-f', name]).catch(() => undefined); await rm(directory, { recursive: true, force: true }); };
  try {
    await Promise.all([mkdir(join(directory, 'meta')), mkdir(join(directory, 'data'))]);
    await writeFile(join(directory, 'garage.toml'), `metadata_dir = "/storage/meta"\ndata_dir = "/storage/data"\ndb_engine = "sqlite"\nreplication_factor = 1\nconsistency_mode = "consistent"\nmetadata_fsync = true\ndata_fsync = true\nrpc_bind_addr = "0.0.0.0:3901"\nrpc_public_addr = "127.0.0.1:3901"\nrpc_secret = "${randomBytes(32).toString('hex')}"\n[s3_api]\ns3_region = "garage"\napi_bind_addr = "0.0.0.0:3900"\n[admin]\napi_bind_addr = "0.0.0.0:3903"\nmetrics_require_token = true\n`, { mode: 0o600 });
    await writeFile(join(directory, 'environment'), `GARAGE_DEFAULT_ACCESS_KEY=${config.accessKeyId}\nGARAGE_DEFAULT_SECRET_KEY=${config.secretAccessKey}\nGARAGE_DEFAULT_BUCKET=${config.bucket}\nGARAGE_ADMIN_TOKEN=${adminToken}\n`, { mode: 0o600 });
    await docker(['run', '--rm', '-d', '--name', name, '--label', 'crewstation.test=rfc035', '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '512m', '--cpus', '1', '-p', '127.0.0.1::3900', '-p', '127.0.0.1::3903', '--env-file', join(directory, 'environment'), '--mount', `type=bind,source=${join(directory, 'garage.toml')},target=/etc/garage.toml,readonly`, '--mount', `type=bind,source=${join(directory, 'meta')},target=/storage/meta`, '--mount', `type=bind,source=${join(directory, 'data')},target=/storage/data`, GARAGE_TEST_IMAGE, '/garage', 'server', '--single-node', '--default-bucket']);
    const address = await docker(['port', name, '3900/tcp']); config.endpoint = `http://${address}`;
    const deadline = Date.now() + 60_000;
    while (true) {
      try { await probeObjectBucket(config, AbortSignal.timeout(2000)); break; }
      catch { if (Date.now() > deadline) throw new Error('Isolated Garage did not become ready'); await Bun.sleep(250); }
    }
    const endpoint = `http://${await docker(['port', name, '3903/tcp'])}`;
    const issued = await fetch(`${endpoint}/v2/CreateAdminToken`, { method: 'POST', signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'cs-observation-only', neverExpires: true, scope: ['GetClusterStatus', 'GetClusterHealth'] }) });
    if (!issued.ok) throw new Error('Cannot issue isolated Garage read-only observation token');
    config.monitoring = { endpoint, token: (await issued.json() as { secretToken: string }).secretToken };
    return { config, dispose, ...garageCredentials(() => config.monitoring!.endpoint, adminToken, config.bucket), restart: async () => {
      await docker(['restart', name]);
      config.endpoint = `http://${await docker(['port', name, '3900/tcp'])}`;
      config.monitoring = { ...config.monitoring!, endpoint: `http://${await docker(['port', name, '3903/tcp'])}` };
    } };
  } catch (error) { await dispose(); throw error; }
}

/** Only the isolated fixture holds a full admin token; tests never receive or log it. */
function garageCredentials(endpoint: () => string, token: string, bucket: string) {
  const request = async (path: string, body?: object) => {
    const response = await fetch(`${endpoint()}/v2/${path}`, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`Isolated Garage credential operation failed (${response.status})`);
    return response;
  };
  return {
    issueCredentials: async () => {
      const created = await (await request('CreateKey', { name: 'rotation-candidate', neverExpires: true })).json() as { accessKeyId: string; secretAccessKey: string };
      const info = await (await request(`GetBucketInfo?globalAlias=${encodeURIComponent(bucket)}`)).json() as { id: string };
      await (await request('AllowBucketKey', { bucketId: info.id, accessKeyId: created.accessKeyId, permissions: { read: true, write: true, owner: false } })).body?.cancel();
      return { accessKeyId: created.accessKeyId, secretAccessKey: created.secretAccessKey };
    },
    revokeCredentials: async (id: string) => { await (await request(`DeleteKey?id=${encodeURIComponent(id)}`, {})).body?.cancel(); },
  };
}
