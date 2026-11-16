import { useCallback, useEffect, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';
import './fullscreen.css';

/** Whether the browser can fullscreen the page (iPhone Safari cannot). */
export const canFullscreen = (): boolean =>
  typeof document !== 'undefined' && document.fullscreenEnabled === true;

/**
 * Fullscreen state for the whole page, with a toggle. Browsers only allow fullscreen from a user
 * gesture, so `auto` enters it on the first click, tap or key press, once per page load; leaving
 * it with Esc stays left.
 */
export const useFullscreen = (
  auto = false,
): { active: boolean; supported: boolean; toggle: () => void } => {
  const [active, setActive] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const sync = () => setActive(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  useEffect(() => {
    if (!auto || !canFullscreen()) return;
    const enter = (event: Event) => {
      // Esc and modifier-only presses are not a request to play.
      if (event instanceof KeyboardEvent && (event.code === 'Escape' || event.metaKey)) return;
      stop();
      if (!document.fullscreenElement)
        void document.documentElement.requestFullscreen().catch(() => {});
    };
    const stop = () => {
      window.removeEventListener('pointerdown', enter, true);
      window.removeEventListener('keydown', enter, true);
    };
    window.addEventListener('pointerdown', enter, true);
    window.addEventListener('keydown', enter, true);
    return stop;
  }, [auto]);
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
      title={label}
      aria-label={label}
      onClick={toggle}
    >
      {active ? <Minimize size={18} /> : <Maximize size={18} />}
    </button>
  );
}
