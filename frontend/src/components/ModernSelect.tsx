import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

// App-wide dropdown coordinator: at most ONE ModernSelect menu is open at a
// time, no matter how many instances exist. Opening a dropdown programmatically
// closes whatever was open before — this is what makes "open one, others close"
// work even when the two triggers never receive each other's events.
let activeCloseFn: (() => void) | null = null;

function openDropdown(closeFn: () => void) {
  activeCloseFn?.();
  activeCloseFn = closeFn;
}

function closeDropdown(closeFn: () => void) {
  if (activeCloseFn === closeFn) activeCloseFn = null;
}

export interface ModernSelectChangeEvent {
  target: { value: string };
}

interface ModernSelectOption {
  value: string;
  label: React.ReactNode;
  disabled: boolean;
}

interface ModernSelectProps {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (e: ModernSelectChangeEvent) => void;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  title?: string;
  children?: React.ReactNode;
}

export const ModernSelect: React.FC<ModernSelectProps> = ({
  value,
  defaultValue,
  onChange,
  className = '',
  disabled,
  id,
  title,
  children
}) => {
  const options = useMemo<ModernSelectOption[]>(() => {
    const list: ModernSelectOption[] = [];
    React.Children.forEach(children, child => {
      if (!React.isValidElement(child)) return;
      const el = child as React.ReactElement<Record<string, unknown>>;
      if (el.type === 'option') {
        const props = el.props as { value?: unknown; children?: React.ReactNode; disabled?: unknown };
        list.push({
          value: props.value === undefined || props.value === null ? '' : String(props.value),
          label: props.children,
          disabled: Boolean(props.disabled)
        });
      }
    });
    return list;
  }, [children]);

  const isControlled = value !== undefined;
  const [innerValue, setInnerValue] = useState(() =>
    defaultValue === undefined ? (options[0]?.value ?? '') : String(defaultValue)
  );
  const currentValue = isControlled ? String(value) : innerValue;
  const current = options.find(o => o.value === currentValue);

  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const closeMenu = useCallback(() => setOpen(false), []);

  const computeMenuStyle = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const triggerGone =
      rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth;
    if (triggerGone) {
      closeMenu();
      return null;
    }
    const width = Math.max(rect.width, 160);
    let left = Math.min(rect.left, window.innerWidth - width - 8);
    if (left < 8) left = 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < 220 && rect.top > spaceBelow;
    return {
      left,
      width,
      ...(flipUp
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
      maxHeight: Math.min(280, flipUp ? rect.top - 16 : spaceBelow - 16)
    };
  }, [closeMenu]);

  useEffect(() => {
    if (!open) return;
    openDropdown(closeMenu);
    const onDocMouseDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScrollOrResize = (e: Event) => {
      const target = e.target instanceof Node ? e.target : null;
      if (e.type === 'scroll' && target && wrapperRef.current?.contains(target)) return;
      setMenuStyle(computeMenuStyle());
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      closeDropdown(closeMenu);
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, closeMenu, computeMenuStyle]);

  const openMenu = () => {
    if (disabled) return;
    setMenuStyle(computeMenuStyle());
    setOpen(true);
  };

  // Fallback: no <option> children detected - keep the native select behaviour.
  if (options.length === 0) {
    return (
      <select
        id={id}
        title={title}
        className={className}
        disabled={disabled}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange as unknown as React.ChangeEventHandler<HTMLSelectElement>}
      >
        {children}
      </select>
    );
  }

  const buttonClass = `${className.replace(/\bpr-8\b/, 'pr-3')} flex items-center justify-between gap-2 text-left appearance-none cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
    open ? 'border-blue-400 ring-2 ring-blue-500/30' : ''
  }`;

  const selectOption = (opt: ModernSelectOption) => {
    if (opt.disabled) return;
    if (!isControlled) setInnerValue(opt.value);
    onChange?.({ target: { value: opt.value } });
    setOpen(false);
  };

  return (
    <span ref={wrapperRef} className="contents">
      <button
        ref={triggerRef}
        type="button"
        id={id}
        title={title}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={buttonClass}
      >
        <span className="min-w-0 truncate flex items-center gap-1.5">{current ? current.label : currentValue}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 pointer-events-none transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && menuStyle && (
        <div
          role="listbox"
          style={menuStyle}
          className="fixed z-50 bg-white border border-slate-200 rounded-xl shadow-lg overflow-y-auto thin-scrollbar py-1 animate-in fade-in zoom-in-95 duration-100"
        >
            {options.map((opt, idx) => {
              const isActive = opt.value === currentValue;
              return (
                <button
                  key={`${opt.value}-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  disabled={opt.disabled}
                  onClick={() => selectOption(opt)}
                  className={`w-full px-3 py-2 flex items-center justify-between gap-2 text-left text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span className="min-w-0 truncate">{opt.label}</span>
                  {isActive && <Check className="w-3.5 h-3.5 shrink-0 text-blue-600" />}
                </button>
              );
            })}
          </div>
      )}
    </span>
  );
};

export default ModernSelect;
