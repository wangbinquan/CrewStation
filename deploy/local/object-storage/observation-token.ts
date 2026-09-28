/** Issue only the two read-only Garage calls consumed by data-control. Never print token output. */
const namespace = process.env.CS_SYSTEM_NAMESPACE ?? 'crewstation-system';
async function kubectl(args: string[], input?: object) {
  const child = Bun.spawn(['kubectl', '--context', process.env.CREWSTATION_KUBE_CONTEXT ?? 'docker-desktop', '-n', namespace, ...args], { stdin: input ? new Blob([JSON.stringify(input)]) : 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code) throw new Error(`Garage observation setup failed (${args[0]})`);
  return output;
}
const current = (await kubectl(['get', 'secret', 'garage-observation', '--ignore-not-found', '-o', 'json'])).trim();
if (current) {
  const data = (JSON.parse(current) as { data?: Record<string, string> }).data;
  if (!data?.CS_GARAGE_OBSERVATION_TOKEN || !Buffer.from(data.CS_GARAGE_OBSERVATION_TOKEN, 'base64').toString().includes('.')) throw new Error('Existing Garage observation token is incomplete; recover it explicitly');
  console.log('Garage observation credentials preserved.');
} else {
  const result = JSON.parse(await kubectl(['exec', '-i', 'garage-0', '--', '/garage', 'json-api', 'CreateAdminToken', '-'],
    { name: 'crewstation-observation', neverExpires: true, scope: ['GetClusterStatus', 'GetClusterHealth'] })) as { secretToken?: string };
  if (!result.secretToken?.includes('.')) throw new Error('Garage did not return the observation credential');
  await kubectl(['create', '-f', '-'], { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'garage-observation', namespace,
    labels: { 'app.kubernetes.io/name': 'garage', 'app.kubernetes.io/part-of': 'crewstation' } }, type: 'Opaque', stringData: { CS_GARAGE_OBSERVATION_TOKEN: result.secretToken } });
  console.log('Scoped Garage observation credentials created.');
}
