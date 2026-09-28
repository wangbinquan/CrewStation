/** Called before reading business configuration, connecting a Runner, or opening the work volume. */
export function storageContractCommand(args: readonly string[], name: 'task-runner' | 'archive-helper', runtime = { platform: process.platform, arch: process.arch }): { name: string; storageContractVersion: 1 } | undefined {
  if (args[0] !== 'storage-contract') return undefined;
  if (args.length !== 2 || args[1] !== '1') throw new Error('Unsupported storage contract version');
  if (runtime.platform !== 'linux' || !['arm64', 'x64'].includes(runtime.arch)) throw new Error('Storage contract requires Linux arm64 or x64');
  return { name, storageContractVersion: 1 };
}
