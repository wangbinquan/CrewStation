export function readTraceId(headers: Headers): string | null {
  const value = headers.get('x-cs-trace-id')?.trim() ?? '';
  return /^[0-9a-f]{32}$/.test(value) ? value : null;
}
