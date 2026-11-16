import { useCallback, useEffect, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';
import './fullscreen.css';

/** Whether the browser can fullscreen the page (iPhone Safari cannot). */
export const canFullscreen = (): boolean =>
  typeof document !== 'undefined' && document.fullscreenEnabled === true;

/** Fullscreen state for the whole page, with a toggle. */
export const useFullscreen = (): { active: boolean; supported: boolean; toggle: () => void } => {
  const [active, setActive] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const sync = () => setActive(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  }, []);
  return { active, supported: canFullscreen(), toggle };
};

/** A corner button that toggles fullscreen, on every screen. */
export function FullscreenButton({ active, toggle }: { active: boolean; toggle: () => void }) {
  const label = active ? 'Exit fullscreen' : 'Fullscreen';
  return (
    <button
      type="button"
      className="fullscreen-toggle"
      title={`${label} (F)`}
      aria-label={label}
      onClick={toggle}
    >
      {active ? <Minimize size={18} /> : <Maximize size={18} />}
    </button>
  );
}
