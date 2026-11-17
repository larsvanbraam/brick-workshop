import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface MenuItem {
  /** Defaults to the label; set it when labels can repeat. */
  key?: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
}

/** A button with a popover list of actions; sections are separated by a divider. */
export function Menu({
  label,
  trigger,
  className = 'quiet',
  sections,
  align = 'end',
}: {
  label: string;
  trigger: ReactNode;
  className?: string;
  sections: { title?: string; items: MenuItem[] }[];
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div className="menu" ref={root}>
      <button
        className={className}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open && (
        <div className={`menu-popover ${align}`} role="menu" id={id}>
          {sections.map((section, index) => (
            <div className="menu-section" key={section.title ?? index}>
              {section.title && <span className="menu-title">{section.title}</span>}
              {section.items.map((item) => (
                <button
                  key={item.key ?? item.label}
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.hint && <small>{item.hint}</small>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
