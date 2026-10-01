import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import './ui.css';

type DateFieldProps = {
  /** yyyy-MM-dd，空串表示未设置 */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
};

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const pad = (n: number): string => String(n).padStart(2, '0');
const toValue = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function parseValue(value: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 设计系统自己的日期选择：月份网格弹层，周一起始，
 * 支持清除与「今天」快捷键，Esc / 点击外部关闭。
 */
export function DateField({ value, onChange, placeholder = '选择日期', ariaLabel }: DateFieldProps) {
  const selected = parseValue(value);
  const today = new Date();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => ({ year: (selected ?? today).getFullYear(), month: (selected ?? today).getMonth() }));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shiftMonth = (delta: number): void => {
    setView((prev) => {
      const next = new Date(prev.year, prev.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  };

  // 周一起始的 6×7 网格：先算出 1 号前面要补几个上月的格子
  const first = new Date(view.year, view.month, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells: Array<{ date: Date; outside: boolean }> = [];
  for (let index = 0 - lead; index < daysInMonth; index += 1) {
    cells.push({ date: new Date(view.year, view.month, index + 1), outside: index < 0 });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ date: new Date(view.year, view.month + 1, cells.length - daysInMonth - lead + 1), outside: true });
  }

  const pick = (date: Date): void => {
    onChange(toValue(date));
    setOpen(false);
  };

  return (
    <div className="ui-date" ref={rootRef}>
      <button
        type="button"
        className={`ui-select-btn${value ? '' : ' is-empty'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel ?? placeholder}
        onClick={() => {
          const base = parseValue(value) ?? new Date();
          setView({ year: base.getFullYear(), month: base.getMonth() });
          setOpen(!open);
        }}
      >
        <Calendar size={13} strokeWidth={1.8} />
        <span className="ui-select-label">{value || placeholder}</span>
        {value ? (
          <span
            role="button"
            aria-label="清除日期"
            className="ui-date-clear"
            onClick={(event) => {
              event.stopPropagation();
              onChange('');
            }}
          >
            ✕
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="ui-date-pop" role="dialog" aria-label="选择日期">
          <div className="ui-date-head">
            <button type="button" aria-label="上个月" onClick={() => shiftMonth(-1)}>
              <ChevronLeft size={14} strokeWidth={1.8} />
            </button>
            <span className="ui-date-title">
              {view.year} 年 {view.month + 1} 月
            </span>
            <button type="button" aria-label="下个月" onClick={() => shiftMonth(1)}>
              <ChevronRight size={14} strokeWidth={1.8} />
            </button>
          </div>
          <div className="ui-date-grid" role="grid">
            {WEEKDAYS.map((day) => (
              <span key={day} className="ui-date-wd">
                {day}
              </span>
            ))}
            {cells.map(({ date, outside }) => {
              const cellValue = toValue(date);
              const isSelected = value === cellValue;
              const isToday = toValue(today) === cellValue;
              return (
                <button
                  key={cellValue}
                  type="button"
                  className={`ui-date-cell${outside ? ' outside' : ''}${isSelected ? ' active' : ''}${isToday ? ' today' : ''}`}
                  onClick={() => pick(date)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="ui-date-foot">
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              清除
            </button>
            <button type="button" onClick={() => pick(today)}>
              今天
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
