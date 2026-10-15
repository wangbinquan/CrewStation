import type { ReactNode } from 'react';
import styles from './BotConversation.module.css';

/** 小范围语义排版：正文、列表、标题与代码。所有文本由 React 转义，不执行 Agent 输出的 HTML。 */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/u).map((part, index) => part.startsWith('`') && part.endsWith('`')
    ? <code key={index}>{part.slice(1, -1)}</code> : part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part);
}
export function BotMessageBody({ text }: { readonly text: string }) {
  const blocks = text.split(/(```[^\n]*\n[\s\S]*?(?:```|$))/u);
  return <div className={styles.prose}>{blocks.map((block, index) => {
    if (block.startsWith('```')) {
      const newline = block.indexOf('\n');
      return <pre key={index}><code>{block.slice(newline + 1).replace(/```$/u, '')}</code></pre>;
    }
    return block.split(/\n\s*\n/u).filter(Boolean).map((paragraph, part) => {
      const lines = paragraph.split('\n'), key = `${index}:${part}`;
      if (lines.every(line => /^\s*[-*] /u.test(line))) return <ul key={key}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\s*[-*] /u, ''))}</li>)}</ul>;
      if (lines.every(line => /^\s*\d+[.)] /u.test(line))) return <ol key={key}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\s*\d+[.)] /u, ''))}</li>)}</ol>;
      if (/^#{1,6} /u.test(paragraph)) return <p className={styles.messageHeading} key={key}>{inline(paragraph.replace(/^#{1,6} /u, ''))}</p>;
      return <p key={key}>{inline(paragraph)}</p>;
    });
  })}</div>;
}
