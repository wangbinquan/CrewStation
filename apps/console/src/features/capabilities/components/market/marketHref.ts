/** Only server-provided hosts can become application links. */
export function marketHref(host: string | undefined): string | undefined {
  return host && /^[a-z\d][a-z\d.-]*(?::\d+)?$/i.test(host) ? `${window.location.protocol === 'https:' ? 'https:' : 'http:'}//${host}` : undefined;
}
