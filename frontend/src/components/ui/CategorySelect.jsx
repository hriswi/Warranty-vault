/**
 * CategorySelect.jsx
 * Dark-themed, keyboard-accessible combobox for the category field.
 * Replaces the native <select> whose white dropdown clashes with the
 * Warranty Vault UI. Keyboard: ↑/↓ navigate, Enter selects, Esc closes.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export default function CategorySelect({ value = '', options = [], onChange, id, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const rootRef = useRef(null);
  const listRef = useRef(null);

  const visibleOptions = Array.isArray(options) ? options.filter((o) => o) : [];
  const selectedIndex = visibleOptions.indexOf(value);

  const close = useCallback(() => {
    setOpen(false);
    setHighlight(-1);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) close();
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, close]);

  useEffect(() => {
    if (open && highlight >= 0 && listRef.current?.children[highlight]) {
      listRef.current.children[highlight].scrollIntoView({ block: 'nearest' });
    }
  }, [open, highlight]);

  const select = (option) => {
    onChange(option);
    close();
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlight(selectedIndex >= 0 ? selectedIndex : 0);
        return;
      }
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      setHighlight((h) => {
        const next = h + dir;
        return next < 0 ? visibleOptions.length - 1 : next % visibleOptions.length;
      });
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (open && highlight >= 0 && visibleOptions[highlight]) {
        e.preventDefault();
        select(visibleOptions[highlight]);
      } else {
        e.preventDefault();
        setOpen(true);
        setHighlight(selectedIndex >= 0 ? selectedIndex : 0);
      }
    } else if (e.key === 'Escape') {
      if (open) close();
    } else if (e.key === 'Tab') {
      close();
    }
  };

  return (
    <div ref={rootRef} className="relative" id={id}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen((o) => !o); setHighlight(selectedIndex); }}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="input-field appearance-none pr-9 text-left flex items-center justify-between gap-2"
        style={{
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: value ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)',
        }}
      >
        <span className="truncate">{value || 'Select…'}</span>
        <ChevronDown
          size={14}
          className="text-white/30 pointer-events-none shrink-0"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-30 mt-1.5 w-full max-h-56 overflow-y-auto rounded-[8px] py-1"
          style={{
            background: '#0d0d0d',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
          }}
        >
          {visibleOptions.map((option, i) => {
            const isSelected = option === value;
            const isHighlighted = i === highlight;
            return (
              <li key={option}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => select(option)}
                  className="w-full flex items-center justify-between gap-2 px-3.5 py-2 text-sm text-left transition-colors"
                  style={{
                    background: isHighlighted ? 'rgba(255,255,255,0.06)' : 'transparent',
                    color: isSelected ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)',
                  }}
                >
                  <span className="truncate">{option}</span>
                  {isSelected && <Check size={13} className="text-white/50 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
