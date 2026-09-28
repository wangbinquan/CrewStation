import type { StorageHealth } from '@crewstation/contracts';
export function storageBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const unit = value === 0 ? 0 : Math.min(4, Math.floor(Math.log(Math.max(1, value)) / Math.log(1024)));
  return `${(value / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit ? 1 : 0 })} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][unit]}`;
}
export const storageTone = (health: StorageHealth) => health === 'ready' ? 'success' as const : health === 'unknown' ? 'neutral' as const : health === 'degraded' ? 'warning' as const : 'danger' as const;
export const storageTime = (value: string | null) => value ? new Date(value).toLocaleString() : '—';
