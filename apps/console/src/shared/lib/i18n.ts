/**
 * 界面文案：每个 feature 在 i18n/zh-CN.ts 与 i18n/en-US.ts 中各自维护消息，
 * 由 app/i18n/messageCatalog.ts 在构建时合并成一个目录；默认语言 zh-CN。
 */
export type Locale = 'zh-CN' | 'en-US';

export const DEFAULT_LOCALE: Locale = 'zh-CN';
export const LOCALES: readonly Locale[] = ['zh-CN', 'en-US'];

/** 一组消息：键以 feature 名为前缀（如 `devSession.title`），值可含 `{name}` 占位。 */
export type Messages = Readonly<Record<string, string>>;

/** 另一语言的消息必须与 zh-CN 的键完全一致；用 `MessagesShapedLike<typeof zhCN>` 声明。 */
export type MessagesShapedLike<T> = Readonly<Record<keyof T, string>>;

export type MessageCatalog = Readonly<Record<Locale, Messages>>;

export interface MessageBundle {
  /** 来源标识（feature 名或文件路径），只用于重复键的报错信息。 */
  readonly source: string;
  readonly messages: Messages;
}

export type MessageValues = Readonly<Record<string, string | number>>;

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** 合并多组消息；键重复视为错误，避免两个 feature 静默覆盖对方的文案。 */
export function mergeMessages(bundles: readonly MessageBundle[]): Messages {
  const merged: Record<string, string> = {};
  const owners = new Map<string, string>();
  for (const bundle of bundles) {
    for (const [key, text] of Object.entries(bundle.messages)) {
      const owner = owners.get(key);
      if (owner !== undefined) throw new Error(`i18n 键重复：${key}（${owner} 与 ${bundle.source}）`);
      owners.set(key, bundle.source);
      merged[key] = text;
    }
  }
  return merged;
}

/** 把 `{name}` 占位替换为值；未提供的占位原样保留。 */
export function formatMessage(template: string, values?: MessageValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = values[name];
    return value === undefined ? placeholder : String(value);
  });
}

/** 查找并格式化；缺键时返回键本身，页面不会因文案缺失而崩溃。 */
export function translate(messages: Messages, key: string, values?: MessageValues): string {
  const template = messages[key];
  return template === undefined ? key : formatMessage(template, values);
}
