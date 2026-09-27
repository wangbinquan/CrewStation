import { CreateRuntimeImageRevisionSchema } from '@crewstation/contracts';

/** Keep draft contents intact while returning a short field path for correction. */
export function parseRecipe(draft: string, hint: string) {
  let value: unknown;
  try { value = JSON.parse(draft); } catch { throw new Error(hint); }
  const result = CreateRuntimeImageRevisionSchema.safeParse(value);
  if (!result.success) throw new Error(`${hint} (${result.error.issues.map((issue) => issue.path.join('.')).join(', ')})`);
  return result.data;
}
