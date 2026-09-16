import { useId } from 'react';
import type { ReactElement } from 'react';
import { FormField } from '../../../shared/ui/FormField';

export interface FieldOption {
  readonly value: string;
  readonly label: string;
}

export interface AdminFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** 给出选项时渲染下拉，否则渲染文本框；值一律是字符串，由调用方窄化。 */
  readonly options?: readonly FieldOption[];
  readonly placeholder?: string;
  readonly title?: string;
  readonly disabled?: boolean;
  readonly inputMode?: 'numeric';
  readonly hint?: string;
  readonly error?: string;
  /** 多行文本（脚本、文件模板）；给出行数即渲染 textarea。 */
  readonly rows?: number;
  readonly monospace?: boolean;
}

/** 管理页表单里绑到字符串状态的一格；排版与外观全部来自 shared 的 FormField，这里只决定控件类型。 */
export function AdminField({ label, value, onChange, options, placeholder, title, disabled = false, inputMode, hint, error, rows, monospace = false }: AdminFieldProps): ReactElement {
  const id = useId(), describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <FormField label={label} hint={hint} error={error} hintId={`${id}-hint`} errorId={`${id}-error`}>
      {options === undefined && rows !== undefined ? (
        <textarea value={value} rows={rows} placeholder={placeholder} title={title} disabled={disabled} spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={describedBy} style={monospace ? { fontFamily: 'var(--cs-font-mono)', fontSize: 'var(--cs-font-size-sm)' } : undefined} onChange={(event) => onChange(event.target.value)} />
      ) : options === undefined ? (
        <input value={value} placeholder={placeholder} title={title} disabled={disabled} inputMode={inputMode} aria-invalid={Boolean(error)} aria-describedby={describedBy} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <select value={value} title={title} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={describedBy} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}
