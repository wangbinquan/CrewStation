/** 去掉 JSONC 的行注释与块注释；字符串里的斜杠保留。管理员配置文件允许注释，CLI 不一定允许，所以合成前先清理。 */
export function stripJsonComments(text: string): string {
  let out = '', inString = false, escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!, next = text[i + 1];
    if (inString) { out += ch; if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i += 1; out += '\n'; continue; }
    if (ch === '/' && next === '*') { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 1; continue; }
    out += ch;
  }
  return out;
}
