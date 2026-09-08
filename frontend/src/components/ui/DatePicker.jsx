/**
 * DatePicker.jsx
 * Dark-themed calendar popover replacing the native browser date input
 * (whose white popup clashes with the UI). Keyboard: arrows move days,
 * Enter selects, Esc closes, PgUp/PgDn months.
 *
 * Value is a YYYY-MM-DD string (or ''). Matches the app's date format.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  format, parseISO, isSameDay, isSameMonth, isToday, addMonths, startOfMonth,
  endOfMonth, startOfWeek, endOfWeek, addDays, subMonths, isValid,
} from 'date-fns';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function parseValue(value) {
  if (typeof value !== 'string' || !value) return null;
  const d = parseISO(value);
  return isValid(d) ? d : null;
}

export default function DatePicker({ value = '', onChange, placeholder = 'Select date…', id, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => parseValue(value) || new Date());
  const rootRef = useRef(null);

  const selected = parseValue(value);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) close();
    };
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open, close]);

  const select = (d) => {
    onChange(format(d, 'yyyy-MM-dd'));
    close();
  };

  const openCalendar = () => {
    if (disabled) return;
    setViewDate(selected || new Date());
    setOpen((o) => !o);
  };

  const grid = [];
  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) grid.push(d);

  const onCalendarKeyDown = (e) => {
    const step = (dir) => {
      e.preventDefault();
      const base = selected || viewDate;
      setViewDate(addDays(base, dir));
    };
    switch (e.key) {
      case 'ArrowLeft': step(-1); break;
      case 'ArrowRight': step(1); break;
      case 'ArrowUp': step(-7); break;
      case 'ArrowDown': step(7); break;
      case 'PageUp': e.preventDefault(); setViewDate((v) => subMonths(v, 1)); break;
      case 'PageDown': e.preventDefault(); setViewDate((v) => addMonths(v, 1)); break;
      case 'Enter':
        e.preventDefault();
        if (selected) onChange(format(selected, 'yyyy-MM-dd'));
        close();
        break;
      default: break;
    }
  };

  return (
    <div ref={rootRef} className="relative" id={id}>
      <button
        type="button"
        disabled={disabled}
        onClick={openCalendar}
        onKeyDown={onCalendarKeyDown}
        className="input-field pr-9 text-left flex items-center justify-between gap-2"
        style={{
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: value ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)',
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="truncate">
          {selected ? format(selected, 'd MMM yyyy') : placeholder}
        </span>
        <CalendarIcon size={14} className="text-white/30 pointer-events-none shrink-0" />
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute z-30 mt-1.5 w-[280px] rounded-[10px] p-4"
          style={{
            background: '#0d0d0d',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
          }}
        >
          {/* Month / year header */}
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => setViewDate((v) => subMonths(v, 1))}
              className="p-1.5 rounded-[6px] text-white/40 hover:text-white/80 hover:bg-white/05 transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft size={15} />
            </button>
            <p className="text-white/70 text-xs font-mono tracking-[0.1em]">
              {format(viewDate, 'MMMM yyyy')}
            </p>
            <button
              type="button"
              onClick={() => setViewDate((v) => addMonths(v, 1))}
              className="p-1.5 rounded-[6px] text-white/40 hover:text-white/80 hover:bg-white/05 transition-colors"
              aria-label="Next month"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          {/* Weekday row */}
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map((w) => (
              <span key={w} className="text-center text-white/20 text-[10px] font-mono py-1">
                {w}
              </span>
            ))}
          </div>

          {/* Days */}
          <div className="grid grid-cols-7" role="grid">
            {grid.map((d, i) => {
              const inMonth = isSameMonth(d, viewDate);
              const isSel = selected ? isSameDay(d, selected) : false;
              const isTodayDay = isToday(d);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => select(d)}
                  className="h-8 text-xs rounded-[6px] transition-colors"
                  style={{
                    color: isSel ? '#000'
                      : inMonth ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.15)',
                    background: isSel ? 'rgba(255,255,255,0.9)' : isTodayDay ? 'rgba(255,255,255,0.08)' : 'transparent',
                    border: isTodayDay && !isSel ? '1px solid rgba(255,255,255,0.15)' : '1px solid transparent',
                  }}
                  onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                  onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = isTodayDay ? 'rgba(255,255,255,0.08)' : 'transparent'; }}
                >
                  {format(d, 'd')}
                </button>
              );
            })}
          </div>

          {selected && (
            <button
              type="button"
              onClick={() => { onChange(''); close(); }}
              className="w-full mt-3 text-center text-[11px] text-white/30 hover:text-white/60 transition-colors"
            >
              Clear date
            </button>
          )}
        </div>
      )}
    </div>
  );
}
