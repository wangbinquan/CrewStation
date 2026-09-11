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
}

/** 管理页表单里绑到字符串状态的一格；排版与外观全部来自 shared 的 FormField，这里只决定控件类型。 */
export function AdminField({ label, value, onChange, options, placeholder, title, disabled = false, inputMode }: AdminFieldProps): ReactElement {
  return (
    <FormField label={label}>
      {options === undefined ? (
        <input value={value} placeholder={placeholder} title={title} disabled={disabled} inputMode={inputMode} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <select value={value} title={title} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
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
