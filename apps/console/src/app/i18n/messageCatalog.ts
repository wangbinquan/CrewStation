import { mergeMessages } from '../../shared/lib/i18n';
import type { Locale, MessageBundle, MessageCatalog, Messages } from '../../shared/lib/i18n';
import { messages as appEnUS } from './en-US';
import { messages as appZhCN } from './zh-CN';

interface MessagesModule {
  readonly messages: Messages;
}

/**
 * 构建时合并：Vite 在编译期按 glob 静态收集每个 feature 的 i18n/<locale>.ts，
 * feature 不需要在 index.ts 中导出文案，app/ 也不需要逐个列举 feature。
 */
const FEATURE_MODULES: Readonly<Record<Locale, Record<string, unknown>>> = {
  'zh-CN': import.meta.glob('../../features/*/i18n/zh-CN.ts', { eager: true }),
  'en-US': import.meta.glob('../../features/*/i18n/en-US.ts', { eager: true }),
};

function toBundle(path: string, module: unknown): MessageBundle {
  const candidate = module as Partial<MessagesModule>;
  if (typeof candidate.messages !== 'object' || candidate.messages === null) {
    throw new Error(`${path} 必须导出 messages 对象`);
  }
  return { source: path, messages: candidate.messages };
}

function catalogFor(locale: Locale, appMessages: Messages): Messages {
  const featureBundles = Object.entries(FEATURE_MODULES[locale]).map(([path, module]) => toBundle(path, module));
  return mergeMessages([{ source: 'app', messages: appMessages }, ...featureBundles]);
}

export const MESSAGE_CATALOG: MessageCatalog = {
  'zh-CN': catalogFor('zh-CN', appZhCN),
  'en-US': catalogFor('en-US', appEnUS),
};
