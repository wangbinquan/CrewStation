import { expect } from 'bun:test';

/** The original database error may be wrapped by drizzle; assert the message anywhere along its cause chain. */
export async function expectRejectionChain(operation: PromiseLike<unknown>, expected: string): Promise<void> {
  const error: unknown = await Promise.resolve(operation).then(() => undefined, (failure: unknown) => failure);
  expect(error).toBeInstanceOf(Error);
  const messages: string[] = [];
  let current = error;
  for (let depth = 0; current instanceof Error && depth < 10; depth++) {
    messages.push(current.message); current = current.cause;
  }
  expect(messages.join('\n')).toContain(expected);
}
