import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { usePopover } from './usePopover';
import './ui.css';

export type SelectOption = { value: string; label: string };

type SelectProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  /** 额外类名，比如塞进既有布局里 */
  className?: string;
};

/**
 * 设计系统自己的下拉选择：弹层跟随令牌配色，支持 Esc 关闭、
 * 方向键移动、Enter 选定、点击外部关闭；空间不足时自动向上翻。
 */
export function Select({ value, options, onChange, ariaLabel, className }: SelectProps) {
  const { open, flip, end, rootRef, toggle, close } = usePopover(264, 260);
  const [cursor, setCursor] = useState(-1);
  const current = options.find((option) => option.value === value);

  const pick = (next: string): void => {
    onChange(next);
    close();
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setCursor(Math.max(0, options.findIndex((option) => option.value === value)));
        toggle();
      }
      return;
    }
    if (event.key === 'Escape') {
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((prev) => Math.min(options.length - 1, prev + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((prev) => Math.max(0, prev - 1));
    } else if ((event.key === 'Enter' || event.key === ' ') && cursor >= 0) {
      event.preventDefault();
      pick(options[cursor].value);
    }
  };

  return (
    <div className={`ui-select${className ? ` ${className}` : ''}`} ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="ui-select-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          setCursor(Math.max(0, options.findIndex((option) => option.value === value)));
          toggle();
        }}
      >
        <span className="ui-select-label">{current?.label ?? ''}</span>
        <ChevronDown size={13} strokeWidth={1.8} />
      </button>
      {open ? (
        <ul className={`ui-select-pop${flip ? ' up' : ''}${end ? ' end' : ''}`} role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => (
            <li key={option.value || '__empty'}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`${option.value === value ? 'active' : ''}${index === cursor ? ' cursor' : ''}`}
                onMouseEnter={() => setCursor(index)}
                onClick={() => pick(option.value)}
              >
                <span>{option.label}</span>
                {option.value === value ? <Check size={13} strokeWidth={2} /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
