/** Preserve a suffix that could still become a credential in the next chunk. No raw tail reaches storage. */
export function secretOutputRedactor(values: readonly string[]) {
  const secrets = [...new Set(values.filter(Boolean))].sort((a, b) => b.length - a.length);
  let pending = '';
  const redact = (text: string) => secrets.reduce((out, secret) => out.split(secret).join('***'), text);
  return {
    push(text: string): string {
      const redacted = redact(pending + text); let suffix = 0;
      for (const secret of secrets) for (let size = Math.min(redacted.length, secret.length - 1); size > suffix; size--) if (redacted.endsWith(secret.slice(0, size))) { suffix = size; break; }
      pending = redacted.slice(redacted.length - suffix); return redacted.slice(0, redacted.length - suffix);
    },
    finish(): string { const result = redact(pending); pending = ''; return result; },
  };
}
