import { useEffect } from 'react';
import type { RefObject } from 'react';
import { moveFocus } from './pad-ui.ts';
import type { Direction } from './gamepad.ts';

const KEYS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/** Whether the arrow keys already mean something on this element (typing, sliders, choices). */
function takesArrows(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return (
    target instanceof HTMLInputElement &&
    !['button', 'checkbox', 'submit', 'reset'].includes(target.type)
  );
}

/** Lets the arrow keys move the focus between a menu's buttons, as a controller's d-pad does. */
export function useArrowNav(root: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const keydown = (event: KeyboardEvent) => {
      const direction = KEYS[event.key];
      const element = root.current;
      if (!direction || !element || event.altKey || event.ctrlKey || event.metaKey) return;
      if (takesArrows(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      moveFocus(element, direction);
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [root, enabled]);
}
