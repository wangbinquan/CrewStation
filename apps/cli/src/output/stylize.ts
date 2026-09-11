/**
 * 颜色只在 stdout 是 TTY 且未被关闭时出现：管道与重定向里必须是干净文本，
 * 否则 `crewstation projects list | grep` 会匹配到转义序列。
 */
export type StyleName = 'bold' | 'dim' | 'red' | 'green' | 'yellow';

const CODES: Readonly<Record<StyleName, string>> = {
  bold: '1', dim: '2', red: '31', green: '32', yellow: '33',
};

export interface Stylist {
  readonly enabled: boolean;
  (style: StyleName, text: string): string;
}

export function createStylist(enabled: boolean): Stylist {
  const apply = (style: StyleName, text: string): string => (enabled ? `[${CODES[style]}m${text}[0m` : text);
  return Object.assign(apply, { enabled });
}

/** 是否上色：显式 --no-color、NO_COLOR 环境变量、非 TTY 三者任一都关闭。 */
export function colourEnabled(input: { readonly isTty: boolean; readonly noColorFlag: boolean; readonly env: Readonly<Record<string, string | undefined>> }): boolean {
  if (input.noColorFlag) return false;
  if (typeof input.env.NO_COLOR === 'string') return false;
  return input.isTty;
}
