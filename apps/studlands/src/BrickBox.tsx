import { useEffect, useMemo, useRef, useState } from 'react';
import { COLORS, getPart } from '@brick-workshop/engine';
import { displayHex } from '@brick-workshop/render/ldraw-materials';
import { usePartThumbnail } from '@brick-workshop/render/part-thumbnails';
import type { Held } from './build.ts';
import { CATEGORIES, categoryOf, colorsFor, placeableParts } from './catalog.ts';
import type { Category } from './catalog.ts';

export const colorName = (id: number) =>
  COLORS.find((color) => color.id === id)?.name ?? `Colour ${id}`;
export const colorHex = (id: number) => {
  const color = COLORS.find((entry) => entry.id === id);
  return color ? displayHex(color) : '#888';
};

/** A part's rendered picture once it scrolls into view, a plain block until then. */
export function PartImage({ partId }: { partId: string }) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const url = usePartThumbnail(partId, element);
  return (
    <span className="part-image" ref={setElement}>
      {url ? <img src={url} alt="" draggable={false} /> : <span className="part-block" />}
    </span>
  );
}

/** Data a dragged tile carries, so a hotbar slot knows which part was dropped on it. */
export const PART_DRAG = 'application/x-brick-part';

export interface BrickBoxProps {
  slots: readonly Held[];
  selected: number;
  /** Puts a part in a slot, keeping the slot's colour where the part comes in it. */
  onAssign: (slot: number, partId: string) => void;
  onColor: (color: number) => void;
  onClose: () => void;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

/**
 * Every part the game can place, by kind, with a search. Clicking a part puts it in the selected
 * slot; pointing at one and pressing 1 to 9 puts it in that slot; dragging it onto a slot works
 * too. The colours below are the ones the selected slot's part really comes in.
 */
export function BrickBox({ slots, selected, onAssign, onColor, onClose }: BrickBoxProps) {
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [query, setQuery] = useState('');
  const hovered = useRef<string | null>(null);
  const handlers = useRef({ onAssign });
  useEffect(() => {
    handlers.current = { onAssign };
  });
  const parts = useMemo(() => placeableParts(), []);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return parts.filter(
      (part) =>
        (category === 'all' || categoryOf(part) === category) &&
        words.every((word) => `${part.name} ${part.id}`.toLowerCase().includes(word)),
    );
  }, [parts, category, query]);
  const counts = useMemo(() => {
    const found = new Map<Category, number>();
    for (const part of parts) found.set(categoryOf(part), (found.get(categoryOf(part)) ?? 0) + 1);
    return found;
  }, [parts]);

  useEffect(() => {
    // 1 to 9 over a part fill that slot; the game closes the box on Esc and B. Typing in the
    // search leaves digits alone.
    const keydown = (event: KeyboardEvent) => {
      if (isTyping(event.target) || !hovered.current || !/^Digit[1-9]$/.test(event.code)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      handlers.current.onAssign(Number(event.code.slice(5)) - 1, hovered.current);
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, []);

  const held = slots[selected];
  const colors = useMemo(() => colorsFor(held.partId), [held.partId]);
  return (
    <div className="box-backdrop" onClick={onClose}>
      <div
        className="box"
        role="dialog"
        aria-label="Brick box"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2>Brick box</h2>
          <input
            type="search"
            placeholder="Search parts"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
          <button type="button" className="close" onClick={onClose} aria-label="Close">
            <kbd>B</kbd>
          </button>
        </header>
        <nav className="categories">
          <button
            type="button"
            className={category === 'all' ? 'selected' : undefined}
            onClick={() => setCategory('all')}
          >
            All <span>{parts.length}</span>
          </button>
          {CATEGORIES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={category === id ? 'selected' : undefined}
              onClick={() => setCategory(id)}
            >
              {label} <span>{counts.get(id) ?? 0}</span>
            </button>
          ))}
        </nav>
        <div className="parts" role="list">
          {shown.map((part) => (
            <button
              key={part.id}
              type="button"
              role="listitem"
              className={part.id === held.partId ? 'part selected' : 'part'}
              title={`${part.name} (${part.id})`}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(PART_DRAG, part.id);
                event.dataTransfer.effectAllowed = 'copy';
              }}
              onMouseEnter={() => (hovered.current = part.id)}
              onMouseLeave={() => {
                if (hovered.current === part.id) hovered.current = null;
              }}
              onClick={() => onAssign(selected, part.id)}
            >
              <PartImage partId={part.id} />
              <span>{part.name}</span>
            </button>
          ))}
          {!shown.length && <p className="empty">No parts match “{query}”.</p>}
        </div>
        <footer>
          <div className="held">
            <PartImage partId={held.partId} />
            <div>
              <strong>{getPart(held.partId).name}</strong>
              <span>
                Slot {selected + 1} · {colorName(held.color)}
              </span>
            </div>
          </div>
          <div className="colors" role="radiogroup" aria-label="Colour">
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={color === held.color}
                aria-label={colorName(color)}
                title={colorName(color)}
                className={color === held.color ? 'swatch selected' : 'swatch'}
                style={{ background: colorHex(color) }}
                onClick={() => onColor(color)}
              />
            ))}
          </div>
          <p className="tip">
            Click a part for slot {selected + 1}, or point at one and press 1–9. Drag parts onto the
            bar below.
          </p>
        </footer>
      </div>
    </div>
  );
}
