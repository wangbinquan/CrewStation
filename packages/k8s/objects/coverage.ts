/** Desired fields must match; API defaults may add fields, while array order and length remain exact. */
export function k8sObjectCovers(live: unknown, desired: unknown): boolean {
  if (Array.isArray(desired) && desired.length === 0 && live === undefined) return true;
  if (Array.isArray(desired)) return Array.isArray(live) && live.length === desired.length && desired.every((item, index) => k8sObjectCovers(live[index], item));
  if (typeof desired === 'object' && desired !== null) {
    return typeof live === 'object' && live !== null && Object.entries(desired).every(([field, value]) => k8sObjectCovers((live as Record<string, unknown>)[field], value));
  }
  return live === desired;
}
