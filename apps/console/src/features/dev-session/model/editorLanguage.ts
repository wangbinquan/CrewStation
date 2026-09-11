import { javascript } from '@codemirror/lang-javascript';
import type { Extension } from '@codemirror/state';

const TYPESCRIPT = /\.(ts|mts|cts)$/i;
const TSX = /\.tsx$/i;
const JSX = /\.jsx$/i;
const JAVASCRIPT = /\.(js|mjs|cjs|json)$/i;

/**
 * 仅装了 JavaScript／TypeScript 语言包：其余后缀按纯文本编辑，不为了高亮再引一堆依赖。
 * JSON 用 javascript() 高亮足够。
 */
export function languageExtension(path: string): Extension {
  if (TSX.test(path)) return javascript({ typescript: true, jsx: true });
  if (TYPESCRIPT.test(path)) return javascript({ typescript: true });
  if (JSX.test(path)) return javascript({ jsx: true });
  if (JAVASCRIPT.test(path)) return javascript();
  return [];
}
