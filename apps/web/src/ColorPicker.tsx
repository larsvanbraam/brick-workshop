import { useId, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { COLORS } from '@lego-builder/brick-engine';
import './color-picker.css';

export function ColorPicker({
  color,
  onChange,
}: {
  color: number;
  onChange: (id: number) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [finish, setFinish] = useState('all');
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = COLORS.filter(
    (entry) =>
      words.every((word) =>
        `${entry.id} ${entry.name} ${entry.finish}`.toLowerCase().includes(word),
      ) &&
      (finish === 'all' ||
        (finish === 'transparent'
          ? entry.alpha < 255
          : finish === 'opaque'
            ? entry.alpha === 255 && entry.finish === 'solid'
            : entry.finish === finish)),
  );
  const selected = COLORS.find((entry) => entry.id === color)!;
  return (
    <div className="color-picker">
      <label className="color-search">
        <Search size={14} aria-hidden="true" />
        <input
          aria-label="Search colors"
          placeholder="Search colors or LDraw ID"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <select
        aria-label="Color finish"
        value={finish}
        onChange={(event) => setFinish(event.target.value)}
      >
        <option value="all">All colors ({COLORS.length})</option>
        <option value="opaque">Opaque solid</option>
        <option value="transparent">Transparent</option>
        {[...new Set(COLORS.map((entry) => entry.finish))]
          .filter((value) => value !== 'solid')
          .map((value) => (
            <option key={value} value={value}>
              {value.replaceAll('-', ' ')}
            </option>
          ))}
      </select>
      <div className="color-swatches" role="group" aria-label="LDraw colors" aria-describedby={id}>
        {matches.map((entry) => (
          <button
            key={entry.id}
            className={`color-tile ${entry.id === color ? 'selected' : ''}`}
            title={`${entry.name}, LDraw ${entry.id}, ${entry.alpha < 255 ? 'transparent, ' : ''}${entry.finish}`}
            aria-label={`${entry.name}, LDraw ${entry.id}`}
            aria-pressed={entry.id === color}
            data-color-id={entry.id}
            onClick={() => onChange(entry.id)}
          >
            <span
              className="color-fill"
              style={{ backgroundColor: entry.hex, opacity: entry.alpha / 255 }}
            />
            {entry.id === color && <Check size={15} className="color-check" aria-hidden="true" />}
          </button>
        ))}
        {!matches.length && <span className="color-empty">No matching colors</span>}
      </div>
      <div className="color-caption" id={id}>
        <strong>{selected.name}</strong>
        <span>
          LDraw {selected.id} /{' '}
          {selected.alpha < 255 ? 'Transparent' : selected.finish.replaceAll('-', ' ')}
        </span>
        <span>{matches.length} colors</span>
      </div>
    </div>
  );
}
