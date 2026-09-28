/** Official deployment preflight: read persistent activation before changing images or running migrations. */
export type StorageGuardCommand = (args: string[]) => Promise<string>;
export function requireCheckedTaskTarget(requiredVersion: number, requireObjects: boolean, skipTaskRuntime: boolean): void {
  if ((requiredVersion > 0 || requireObjects) && skipTaskRuntime) throw new Error('Object storage requires a checked task runtime image; CS_SKIP_TASK_RUNTIME is not allowed');
}
export async function storageDeploymentPreflight(run: StorageGuardCommand, namespace: string, images: readonly string[], requireObjects: boolean) {
  const query = (sql: string) => run(['kubectl', '-n', namespace, 'exec', 'statefulset/postgres', '--', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1 -c "$1"', '--', sql]);
  const present = (await query("SELECT to_regclass('data.storage_contract') IS NOT NULL")).trim();
  if (!['t', 'f'].includes(present)) throw new Error('Cannot determine persistent storage contract');
  if (present === 'f' && (await query("SELECT to_regclass('data.object_spaces') IS NULL")).trim() !== 't') throw new Error('Object metadata exists without a contract marker; deployment blocked');
  const required = present === 't' ? Number((await query("SELECT required_version FROM data.storage_contract WHERE id='service-object-storage'")).trim() || 'unknown') : 0;
  if (!Number.isSafeInteger(required) || required < 0) throw new Error('Persistent storage contract is unreadable; deployment blocked');
  const minimum = Math.max(required, requireObjects ? 1 : 0), snapshots = [];
  for (const image of images) {
    const descriptor = JSON.parse(await run(['docker', 'image', 'inspect', image, '--format', '{{json .}}'])) as { Id: string; Config?: { Labels?: Record<string, string> } };
    const supported = Number(descriptor.Config?.Labels?.['io.crewstation.storage-contract'] ?? 0);
    if (!Number.isSafeInteger(supported) || supported < minimum || !/^sha256:[a-f0-9]{64}$/.test(descriptor.Id)) throw new Error(`Image ${image} does not support storage contract ${minimum}; deployment blocked`);
    snapshots.push({ image, id: descriptor.Id });
  }
  return { requiredVersion: required, images: snapshots };
}
export async function runStorageGuardCommand(args: string[]): Promise<string> {
  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const [code, output] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (code) throw new Error(`Storage compatibility preflight failed (${args[0]}); no deployment is authorized`);
  return output;
}
if (import.meta.main) {
  const images = ['cs-control-plane:dev', 'cs-console:dev', ...(process.env.CS_SKIP_TASK_RUNTIME === '1' ? [] : ['cs-task-runtime:dev'])];
  const result = await storageDeploymentPreflight(runStorageGuardCommand, process.env.CS_SYSTEM_NAMESPACE ?? 'crewstation-system', images, process.env.CS_INSTALL_OBJECT_STORAGE === '1');
  requireCheckedTaskTarget(result.requiredVersion, process.env.CS_INSTALL_OBJECT_STORAGE === '1', process.env.CS_SKIP_TASK_RUNTIME === '1');
  console.log(`Storage compatibility verified for ${result.images.length} images; persistent contract ${result.requiredVersion}`);
}
