import { expect, test } from 'bun:test';
import { secretOutputRedactor } from './secretOutput';
test('a credential split at every possible chunk boundary is redacted before durable output', () => {
  const value = 'private-git-token';
  for (let split = 1; split < value.length; split++) {
    const redactor = secretOutputRedactor([value]);
    expect(redactor.push(`before:${value.slice(0, split)}`) + redactor.push(`${value.slice(split)}:after`) + redactor.finish()).toBe('before:***:after');
  }
});
test('ordinary output and incomplete prefixes are retained and empty credentials do not erase text', () => {
  const redactor = secretOutputRedactor(['', 'abcdef', 'abc']);
  expect(redactor.push('abcdef abc xab') + redactor.finish()).toBe('*** *** xab');
  expect(redactor.finish()).toBe('');
});
