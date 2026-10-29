import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from 'react';

/* ------------------------------------------------------------------ */
/* Primitive contracts – hosts may swap any of these for their own UI kit */
/* ------------------------------------------------------------------ */

export interface ButtonProps {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  title?: string;
  active?: boolean;
  icon?: ReactNode;
  className?: string;
  type?: 'button' | 'submit';
}

export interface InputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called on blur / Enter – useful for committing expensive changes. */
  onCommit?: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'number' | 'date' | 'datetime-local' | 'color' | 'search';
  disabled?: boolean;
  invalid?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
  autoFocus?: boolean;
  id?: string;
  /** Numbers for number inputs, yyyy-MM-dd for date inputs. */
  min?: number | string;
  max?: number | string;
  step?: number;
  required?: boolean;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  title?: string;
  className?: string;
  multiple?: boolean;
  values?: string[];
  onChangeMultiple?: (values: string[]) => void;
  id?: string;
}

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  title?: string;
  id?: string;
}

export interface TextAreaProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  invalid?: boolean;
  className?: string;
  spellCheck?: boolean;
  id?: string;
  textareaRef?: (el: HTMLTextAreaElement | null) => void;
  onSelect?: () => void;
}

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export interface UIComponents {
  Button: ComponentType<ButtonProps>;
  Input: ComponentType<InputProps>;
  Select: ComponentType<SelectProps>;
  Checkbox: ComponentType<CheckboxProps>;
  TextArea: ComponentType<TextAreaProps>;
  Dialog: ComponentType<DialogProps>;
}

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(' ');

function DefaultButton({ children, onClick, variant = 'default', disabled, title, active, icon, className, type = 'button' }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('er-btn', `er-btn--${variant}`, active && 'er-btn--active', !children && 'er-btn--icon', className)}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={!children ? title : undefined}
      aria-pressed={active}
    >
      {icon}
      {children && <span>{children}</span>}
    </button>
  );
}

function DefaultInput({ value, onChange, onCommit, placeholder, type = 'text', disabled, invalid, title, className, style, autoFocus, id, min, max, step, required }: InputProps) {
  // Local state lets number inputs hold intermediate values like "-" or "1." while typing.
  const [local, setLocal] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setLocal(value);
  }, [value]);
  return (
    <input
      id={id}
      className={cx('er-input', invalid && 'er-input--invalid', className)}
      style={style}
      type={type}
      value={local}
      placeholder={placeholder}
      disabled={disabled}
      title={title}
      autoFocus={autoFocus}
      min={min}
      max={max}
      step={step}
      required={required}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        setLocal(e.target.value);
        onChange(e.target.value);
      }}
      onBlur={(e) => {
        focused.current = false;
        onCommit?.(e.target.value);
        setLocal(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit?.((e.target as HTMLInputElement).value);
        e.stopPropagation();
      }}
    />
  );
}

function DefaultSelect({ value, onChange, options, disabled, title, className, multiple, values, onChangeMultiple, id }: SelectProps) {
  if (multiple) {
    return (
      <select
        id={id}
        multiple
        className={cx('er-select', 'er-select--multi', className)}
        value={values ?? []}
        disabled={disabled}
        title={title}
        onChange={(e) => onChangeMultiple?.(Array.from(e.target.selectedOptions).map((o) => o.value))}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <select id={id} className={cx('er-select', className)} value={value} disabled={disabled} title={title} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function DefaultCheckbox({ checked, onChange, label, disabled, title, id }: CheckboxProps) {
  return (
    <label className="er-check" title={title}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label && <span>{label}</span>}
    </label>
  );
}

function DefaultTextArea({ value, onChange, rows = 3, placeholder, invalid, className, spellCheck = false, id, textareaRef, onSelect }: TextAreaProps) {
  return (
    <textarea
      id={id}
      ref={textareaRef}
      className={cx('er-input', 'er-textarea', invalid && 'er-input--invalid', className)}
      value={value}
      rows={rows}
      placeholder={placeholder}
      spellCheck={spellCheck}
      onChange={(e) => onChange(e.target.value)}
      onSelect={onSelect}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
}

function DefaultDialog({ open, title, onClose, children, footer, width = 560 }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="er-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="er-dialog" role="dialog" aria-modal="true" style={{ width }} ref={ref} tabIndex={-1}>
        <div className="er-dialog__header">
          <span>{title}</span>
          <button type="button" className="er-btn er-btn--ghost er-btn--icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="er-dialog__body">{children}</div>
        {footer && <div className="er-dialog__footer">{footer}</div>}
      </div>
    </div>
  );
}

export const DEFAULT_COMPONENTS: UIComponents = {
  Button: DefaultButton,
  Input: DefaultInput,
  Select: DefaultSelect,
  Checkbox: DefaultCheckbox,
  TextArea: DefaultTextArea,
  Dialog: DefaultDialog,
};

export { cx };
