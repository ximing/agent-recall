import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePopover } from './usePopover';
import './ui.css';

export type SearchSelectOption = {
  value: string;
  label: string;
  hint?: string;
};

type SearchSelectProps = {
  value: string;
  options: SearchSelectOption[];
  onChange: (value: string) => void;
  /** 输入框变化时回调，用来向服务端要更多候选项。组件自己仍会在当前 options 里即时过滤。 */
  onSearch?: (query: string) => void;
  placeholder: string;
  ariaLabel: string;
  /** 有搜索词但没有命中 */
  emptyText: string;
  /** 还没有任何候选项 */
  blankText: string;
  loading?: boolean;
  /** 会话 ID 这类值用等宽字 */
  mono?: boolean;
};

/**
 * 可搜索的选择：打开后输入关键字，在已有候选项里点选。
 * 不会把没点中的输入当成筛选值。
 */
export function SearchSelect({
  value,
  options,
  onChange,
  onSearch,
  placeholder,
  ariaLabel,
  emptyText,
  blankText,
  loading = false,
  mono = false,
}: SearchSelectProps) {
  const { open, flip, end, rootRef, openPopover, close } = usePopover(320, 320);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? options.filter((option) => {
        const haystack = `${option.label}\n${option.value}\n${option.hint ?? ''}`.toLowerCase();
        return haystack.includes(needle);
      })
    : options;

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setCursor((prev) => (filtered.length === 0 ? 0 : Math.min(prev, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, cursor, filtered.length]);

  const pick = (next: string): void => {
    onChange(next);
    close();
  };

  const openList = (): void => {
    setQuery('');
    const selected = options.findIndex((option) => option.value === value);
    setCursor(selected >= 0 ? selected : 0);
    onSearch?.('');
    openPopover();
  };

  const onQuery = (next: string): void => {
    setQuery(next);
    setCursor(0);
    onSearch?.(next);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((prev) => Math.min(filtered.length - 1, prev + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((prev) => Math.max(0, prev - 1));
    } else if (event.key === 'Enter' && cursor >= 0 && filtered[cursor]) {
      event.preventDefault();
      pick(filtered[cursor].value);
    }
  };

  return (
    <div className="ui-select ui-search-select" ref={rootRef}>
      <button
        type="button"
        className={`ui-select-btn${value ? '' : ' is-empty'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          if (open) close();
          else openList();
        }}
      >
        <span className={`ui-select-label${mono && value ? ' mono' : ''}`} title={value || undefined}>
          {value || placeholder}
        </span>
        {value ? (
          <span
            role="button"
            aria-label={`清除${ariaLabel}`}
            className="ui-date-clear"
            onClick={(event) => {
              event.stopPropagation();
              onChange('');
              close();
            }}
          >
            ✕
          </span>
        ) : (
          <ChevronDown size={13} strokeWidth={1.8} />
        )}
      </button>
      {open ? (
        <div
          className={`ui-search-pop${flip ? ' up' : ''}${end ? ' end' : ''}`}
          onKeyDown={onKeyDown}
        >
          <input
            ref={inputRef}
            className="ui-search-query"
            value={query}
            placeholder="输入以搜索"
            aria-label={`${ariaLabel}搜索`}
            autoComplete="off"
            onChange={(event) => onQuery(event.target.value)}
          />
          {filtered.length === 0 ? (
            <p className="ui-search-empty">{loading ? '正在读取…' : needle ? emptyText : blankText}</p>
          ) : (
            <ul ref={listRef} className="ui-search-list" role="listbox" aria-label={ariaLabel}>
              {filtered.map((option, index) => (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    data-active={index === cursor ? 'true' : undefined}
                    className={`${option.value === value ? 'active' : ''}${index === cursor ? ' cursor' : ''}`}
                    title={option.value}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => pick(option.value)}
                  >
                    <span className="ui-search-copy">
                      <span className={`ui-search-name${mono ? ' mono' : ''}`}>{option.label}</span>
                      {option.hint ? <span className="ui-search-hint">{option.hint}</span> : null}
                    </span>
                    {option.value === value ? <Check size={13} strokeWidth={2} /> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
