/**
 * A controller in the brick box and the menu: moving the focus between their buttons, pressing
 * the focused one, switching tabs and scrolling. Works on whatever the open panel holds, so the
 * panels need no controller code of their own beyond a few data attributes:
 *
 * - `data-pad-start` on the button the focus starts on;
 * - `data-pad-tabs` on the row of tabs LB and RB step through (the selected one has
 *   `aria-selected="true"` or the class `selected`).
 *
 * While the controller is in use the page has the class `pad`, which shows a ring round the
 * controller's button (the class `pad-focus`); moving the mouse takes it away again.
 */
import { nextBox } from './gamepad.ts';
import type { Direction } from './gamepad.ts';

/** What the focus can land on: buttons and choices, not text fields a controller cannot type in. */
const TARGETS = [
  'button:not(:disabled)',
  'input[type="radio"]:not(:disabled)',
  'input[type="checkbox"]:not(:disabled)',
  'select:not(:disabled)',
  'a[href]',
].join(',');

/** Pixels a second the right stick scrolls at full tilt. */
const SCROLL_SPEED = 1200;

export const PAD_CLASS = 'pad';

function targets(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(TARGETS)].filter(
    (element) => element.getClientRects().length > 0,
  );
}

/** Marks the controller's button, which shows even while the window itself is not focused. */
const FOCUS_CLASS = 'pad-focus';

function focus(element: HTMLElement) {
  for (const marked of document.querySelectorAll(`.${FOCUS_CLASS}`))
    marked.classList.remove(FOCUS_CLASS);
  element.classList.add(FOCUS_CLASS);
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  document.documentElement.classList.add(PAD_CLASS);
}

/** The focused target in the panel, if the focus is on one. */
function focused(root: HTMLElement, list: HTMLElement[]) {
  const active = document.activeElement;
  return active instanceof HTMLElement && root.contains(active) && list.includes(active)
    ? active
    : null;
}

/** Puts the focus on the panel's starting button, or its first. */
function focusStart(root: HTMLElement, list: HTMLElement[]) {
  const start = root.querySelector<HTMLElement>('[data-pad-start]');
  const target = start && list.includes(start) ? start : list[0];
  if (target) focus(target);
}

/** Moves the focus to the nearest button that way; the first move only shows where it is. */
export function moveFocus(root: HTMLElement, direction: Direction) {
  const list = targets(root);
  const current = focused(root, list);
  if (!current) return focusStart(root, list);
  // Within a scrolling list the focus keeps to the list until its end, scrolling it along; only
  // then does it move on to buttons in sight outside it.
  const from = scroller(current, root);
  const nearest = (candidates: HTMLElement[]) => {
    const index = nextBox(
      current.getBoundingClientRect(),
      candidates.map((element) => element.getBoundingClientRect()),
      direction,
    );
    return index >= 0 ? candidates[index] : null;
  };
  const others = list.filter((element) => element !== current);
  const inList = from === root ? [] : others.filter((element) => scroller(element, root) === from);
  // Outside it, buttons in other lists count only where they show; the panel's own always do.
  const outside = others.filter(
    (element) =>
      !inList.includes(element) && (scroller(element, root) === root || inSight(element, root)),
  );
  const next = nearest(inList) ?? nearest(outside);
  if (next) focus(next);
  else document.documentElement.classList.add(PAD_CLASS);
}

/** Presses the focused button, or with none focused yet, shows where the focus starts. */
export function pressFocused(root: HTMLElement) {
  const list = targets(root);
  const current = focused(root, list);
  if (!current) return focusStart(root, list);
  current.click();
  document.documentElement.classList.add(PAD_CLASS);
}

/** Selects the tab `step` along from the selected one, wrapping round. */
export function switchTab(root: HTMLElement, step: number) {
  const tabs = root.querySelector<HTMLElement>('[data-pad-tabs]');
  if (!tabs) return;
  const buttons = [...tabs.querySelectorAll<HTMLElement>('button:not(:disabled)')];
  if (!buttons.length) return;
  const at = buttons.findIndex(
    (button) =>
      button.getAttribute('aria-selected') === 'true' || button.classList.contains('selected'),
  );
  const next = buttons[(Math.max(0, at) + step + buttons.length) % buttons.length];
  next.click();
  // A focus left on a tab follows the selection along.
  if (document.activeElement && tabs.contains(document.activeElement)) focus(next);
}

/** The scrolling box round an element inside the panel, or the panel. */
function scroller(element: HTMLElement, root: HTMLElement) {
  let at = element.parentElement;
  while (at && at !== root && !scrolls(at)) at = at.parentElement;
  return at ?? root;
}

/** Whether an element shows within the scrolling box round it. */
function inSight(element: HTMLElement, root: HTMLElement) {
  const box = element.getBoundingClientRect();
  const view = scroller(element, root).getBoundingClientRect();
  return (
    box.bottom > view.top && box.top < view.bottom && box.right > view.left && box.left < view.right
  );
}

function scrolls(element: HTMLElement) {
  if (element.scrollHeight <= element.clientHeight + 1) return false;
  const overflow = getComputedStyle(element).overflowY;
  return overflow === 'auto' || overflow === 'scroll';
}

/**
 * Scrolls whatever scrolls round the focus; failing that the panel, or the part of it marked
 * `data-pad-scroll`.
 */
export function scrollPanel(root: HTMLElement, x: number, y: number, seconds: number) {
  if (!x && !y) return;
  const active = document.activeElement;
  let element: HTMLElement = active instanceof HTMLElement && root.contains(active) ? active : root;
  while (element !== root && !scrolls(element)) element = element.parentElement ?? root;
  if (element === root && !scrolls(root))
    element = root.querySelector<HTMLElement>('[data-pad-scroll]') ?? root;
  element.scrollBy(x * SCROLL_SPEED * seconds, y * SCROLL_SPEED * seconds);
}
